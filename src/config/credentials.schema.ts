import { z } from 'zod';

export const CredentialsSchema = z.object({
  supabase: z
    .object({
      url: z.string().optional(),
      key: z.string().optional(),
      service_role_key: z.string().optional(),
      project_url: z.string().optional(),
    })
    .optional(),
  redis: z
    .object({
      url: z.string().optional(),
    })
    .optional(),
  familles_ia: z.record(z.string(), z.string()).optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;
