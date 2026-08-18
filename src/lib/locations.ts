import { z } from "zod";
import { parseGoogleStreetViewUrl } from "./google-street-view";

const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const rawStreetViewSchema = z.object({
  id: z.string().min(1),
  google_map_url: z.string().trim().default(""),
  local_image_path: z
    .string()
    .trim()
    .refine(
      (path) =>
        !path ||
        (!path.startsWith("/") &&
          !path.includes("..") &&
          !/^[a-z][a-z\d+.-]*:/i.test(path)),
      "local_image_path 必须是 public 目录下的相对路径",
    )
    .default(""),
  viewpoint: coordinatesSchema.optional(),
  panoId: z.string().min(1).nullable().optional(),
  heading: z.number().min(0).max(360).default(0),
  pitch: z.number().min(-90).max(90).default(0),
  fov: z.number().min(10).max(120).default(80),
  caption: z.string().min(1),
  alt: z.string().min(1),
});

export const streetViewSchema = rawStreetViewSchema.transform(
  (streetView, context) => {
    if (!streetView.google_map_url) return streetView;

    try {
      const parsed = parseGoogleStreetViewUrl(streetView.google_map_url);
      return {
        ...streetView,
        viewpoint: parsed.coordinates,
        panoId: parsed.panoId,
        heading: parsed.heading,
        pitch: parsed.pitch,
        fov: parsed.fov,
      };
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["google_map_url"],
        message:
          error instanceof Error
            ? `无法解析 Google Street View URL：${error.message}`
            : "无法解析 Google Street View URL",
      });
      return z.NEVER;
    }
  },
);

const rawLocationSchema = z.object({
  id: z.string().min(1),
  countrySlug: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  slug: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  title: z.string().min(1),
  coordinates: coordinatesSchema.optional(),
  summary: z.string().min(1),
  minZoom: z.number().min(0).max(22).default(4),
  tags: z.array(z.string().min(1)).default([]),
  status: z.enum(["draft", "published", "archived"]).default("draft"),
  streetViews: z.array(streetViewSchema).min(1),
});

export const locationSchema = rawLocationSchema.transform(
  (location, context) => {
    const firstStreetView = location.streetViews[0];
    const urlCoordinates = firstStreetView?.google_map_url
      ? firstStreetView.viewpoint
      : undefined;
    const coordinates =
      urlCoordinates ?? location.coordinates ?? firstStreetView?.viewpoint;

    if (!coordinates) {
      context.addIssue({
        code: "custom",
        path: ["coordinates"],
        message:
          "需要 coordinates，或在第一条 streetViews 中提供可解析的 google_map_url/viewpoint",
      });
      return z.NEVER;
    }

    return { ...location, coordinates };
  },
);

export type GeoLocation = z.output<typeof locationSchema>;
export type StreetView = z.output<typeof streetViewSchema>;

const modules = import.meta.glob("../data/locations/**/*.json", {
  eager: true,
  import: "default",
});

const parsedLocations = Object.entries(modules).map(([path, value]) => {
  const result = locationSchema.safeParse(value);
  if (!result.success) {
    throw new Error(`Invalid location data in ${path}: ${result.error.message}`);
  }
  return result.data;
});

const ids = new Set<string>();
const slugs = new Set<string>();

for (const location of parsedLocations) {
  if (ids.has(location.id)) {
    throw new Error(`Duplicate location id: ${location.id}`);
  }
  ids.add(location.id);

  const scopedSlug = `${location.countrySlug}/${location.slug}`;
  if (slugs.has(scopedSlug)) {
    throw new Error(`Duplicate location slug: ${scopedSlug}`);
  }
  slugs.add(scopedSlug);
}

export const locations = parsedLocations.filter(
  (location) => location.status === "published",
);
