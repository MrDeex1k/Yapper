import { z } from "zod";

export const catalogName = z
  .string()
  .trim()
  .min(1)
  .refine((name) => Array.from(name).length <= 64 && !/\p{Cc}/u.test(name));

export const channelForm = z.object({
  name: catalogName,
  kind: z.enum(["text", "voice"]),
  categoryId: z.union([z.literal(""), z.guid()]),
});

export type ChannelForm = z.infer<typeof channelForm>;
