import { z } from "zod";

export const channelForm = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((name) => !/\p{Cc}/u.test(name)),
  kind: z.enum(["text", "voice"]),
  categoryId: z.union([z.literal(""), z.guid()]),
});

export type ChannelForm = z.infer<typeof channelForm>;
