import { z } from 'zod';

// === Base Config Schema (config.json) ===
export const AppConfigSchema = z.object({
  backlog_protection: z.object({
    enabled: z.boolean(),
    message_stale_threshold_seconds: z.number().int().positive(),
    cooldown_between_responses_ms: z.number().int().nonnegative(),
    max_messages_on_startup: z.number().int().positive(),
  }),
  voice_transcription: z.object({
    mode: z.enum(['restricted', 'full']),
  }),
  name: z.string().optional(),
});

// === Models Config Schema (models_config.json) ===
export const ModelsConfigSchema = z
  .object({
    reglages_generaux: z.object({
      familles_prioritaires: z.array(z.string()),
      mode_proactif: z.boolean(),
      embeddings: z.object({
        primary: z.object({
          provider: z.string(),
          model: z.string(),
          dimensions: z.number().int().positive(),
          task_types: z.boolean().optional(),
        }),
        fallback: z.object({
          provider: z.string(),
          model: z.string(),
          dimensions: z.number().int().positive(),
        }),
      }),
      quota_safety: z
        .object({
          rpm_margin: z.number().min(0).max(1),
          tpm_margin: z.number().min(0).max(1),
          rpd_margin: z.number().min(0).max(1),
          emergency_rpm_margin: z.number().min(0).max(1),
          emergency_tpm_margin: z.number().min(0).max(1),
          emergency_rpd_margin: z.number().min(0).max(1),
        })
        .optional(),
      audio_strategy: z
        .object({
          prefer_native: z.boolean(),
          fallback_to_cascade: z.boolean(),
          native_for_groups: z.boolean(),
          preserve_emotions: z.boolean(),
          max_native_duration_seconds: z.number().int().positive(),
          native_voice: z.string(),
        })
        .optional(),
      service_recipes: z.record(z.string(), z.any()).optional(),
      chat_recipes: z.record(z.string(), z.any()).optional(),
      model_capabilities: z.record(z.string(), z.any()).optional(),
    }),
    familles: z.record(z.string(), z.any()),
    voice_provider: z.record(z.string(), z.any()).optional(),
  })
  .passthrough();

// === Scheduler Schema (scheduler.json) ===
export const SchedulerSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string(),
  jobs: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      cron: z.string(),
      enabled: z.boolean(),
      target: z
        .object({
          type: z.enum(['groups', 'private']),
          filter: z.string(),
        })
        .optional(),
      comment: z.string().optional(),
    }),
  ),
  triggers: z.object({
    onKeyword: z.object({
      enabled: z.boolean(),
      keywords: z.array(z.string()),
      probability: z.number().min(0).max(1),
    }),
    onMention: z.object({
      enabled: z.boolean(),
      replyDelay: z.string(),
    }),
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type SchedulerConfig = z.infer<typeof SchedulerSchema>;
