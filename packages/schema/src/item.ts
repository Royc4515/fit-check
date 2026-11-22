import { z } from "zod";
import { ItemTagsSchema } from "./item-tags.ts";

export const ITEM_STATUSES = ["active", "virtual", "archived"] as const;
export const AVAILABILITIES = ["home", "laundry", "away", "lent"] as const;
export const ITEM_SOURCES = ["photo", "sheet", "link", "receipt"] as const;

/**
 * An item as the engine sees it: the DB row flattened with its tags.
 * Images and prices are optional because the sheet import produces items without them.
 */
export const ItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  brand: z.string().nullable(),
  tags: ItemTagsSchema,
  status: z.enum(ITEM_STATUSES),
  availability: z.enum(AVAILABILITIES),
  source: z.enum(ITEM_SOURCES),
  price: z.number().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  purchased_at: z.string().date().nullable(),
  cutout_path: z.string().nullable(),
  thumb_path: z.string().nullable().optional(),
  notes: z.string().nullable(),
});

export type Item = z.infer<typeof ItemSchema>;
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type Availability = (typeof AVAILABILITIES)[number];
