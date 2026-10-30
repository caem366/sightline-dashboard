import { z } from 'zod';

export const termKind = z.enum(['seat_monthly','seat_annual','usage_monthly','fixed_monthly','fixed_annual','one_time','implementation','migration','support_monthly','support_annual','discount_percent','escalation_percent','minimum_annual','tier_monthly','tax_percent','benefit_annual','discount_rate']);
export type TermKind = z.infer<typeof termKind>;
export const tierSchema = z.object({ upTo: z.number().int().positive().nullable(), price: z.string().regex(/^\d+(\.\d+)?$/) });
export const termSchema = z.object({
  kind: termKind, value: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().length(3).default('CAD'), unit: z.string().min(1),
  startMonth: z.number().int().min(0).default(0), endMonth: z.number().int().min(1).nullable().default(null),
  tiers: z.array(tierSchema).optional(), tierMode: z.enum(['graduated','volume']).optional(),
  capPercent: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  note: z.string().default('')
}).superRefine((t,ctx)=>{
  if (t.endMonth!==null && t.endMonth<=t.startMonth) ctx.addIssue({code:'custom',message:'End must follow start'});
  if (t.kind==='tier_monthly'){
    if(!t.tiers?.length||!t.tierMode||t.tiers.at(-1)?.upTo!==null)ctx.addIssue({code:'custom',message:'Tier definition must end with an open tier'});
    let last=0;for(const tier of t.tiers??[]){if(tier.upTo!==null){if(tier.upTo<=last)ctx.addIssue({code:'custom',message:'Tier thresholds must increase'});last=tier.upTo;}}
  }
});
export type Term = z.infer<typeof termSchema>;
export const projectSchema = z.object({name:z.string().trim().min(1).max(120), objective:z.string().max(1000).default(''), currency:z.string().length(3).default('CAD'), years:z.number().int().min(1).max(5).default(5), seats:z.number().int().min(0).max(1_000_000).default(100), usage:z.number().min(0).max(1_000_000_000).default(0), growthPercent:z.number().min(-100).max(1000).default(0)});
export type ProjectInput = z.infer<typeof projectSchema>;
export const scenarioSchema = z.object({ seats:z.number().int().min(0).max(1_000_000).optional(), usage:z.number().min(0).max(1_000_000_000).optional(), growthPercent:z.number().min(-100).max(1000).optional(), years:z.number().int().min(1).max(5).optional(), overrides:z.record(z.string(),z.string().regex(/^\d+(\.\d+)?$/)).default({}) });
export type Scenario = z.infer<typeof scenarioSchema>;
export type ReviewStatus = 'proposed'|'approved'|'rejected'|'ambiguous';
export type Assumption = Term & { id:string; vendorId:string; sourcePassageId:string|null; status:ReviewStatus; revision:number; provenance:'document'|'user'; documentVersionId:string|null };
export type Project = ProjectInput & {id:string; createdAt:string; currentModelId:string|null};
export type Vendor = {id:string; projectId:string; name:string};
export type ResultLine = {vendorId:string; month:number; year:number; category:string; amount:string; formulaKey:string; assumptionIds:string[]};
export type VendorResult = {vendorId:string; years:string[]; total:string; categories:Record<string,string>; lines:ResultLine[]; decisionMetrics?:{annualBenefits:string[];roiPercent:string;npv:string;paybackYear:number|null}};
export type ModelResult = {vendors:VendorResult[]; currency:string; warnings:string[]; comparable:boolean; cheaperVendorId:string|null; difference:string|null; switchingValue:string|null};
