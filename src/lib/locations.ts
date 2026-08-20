import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import { parseGoogleStreetViewUrl } from "./google-street-view";

const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const emptyStringSchema = z.preprocess(
  (value) => (value === null || value === undefined ? "" : value),
  z.string().trim(),
);

const optionalCoordinatesSchema = z.preprocess(
  (value) => (value === null || value === "" ? undefined : value),
  coordinatesSchema.optional(),
);

const numberWithDefault = (fallback: number, schema: z.ZodNumber) =>
  z.preprocess(
    (value) =>
      value === null || value === undefined || value === "" ? fallback : value,
    schema,
  );

const slugSchema = emptyStringSchema.refine(
  (value) => !value || /^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(value),
  "只能包含小写字母、数字和下划线",
);

const rawStreetViewSchema = z.object({
  id: emptyStringSchema,
  google_map_url: emptyStringSchema,
  local_image_path: emptyStringSchema
    .refine(
      (path) =>
        !path ||
        (!path.startsWith("/") &&
          !path.includes("..") &&
          !/^[a-z][a-z\d+.-]*:/i.test(path)),
      "local_image_path 必须是 public 目录下的相对路径",
    ),
  viewpoint: optionalCoordinatesSchema,
  panoId: z.preprocess(
    (value) => (value === null || value === undefined || value === "" ? null : value),
    z.string().min(1).nullable(),
  ),
  heading: numberWithDefault(0, z.number().min(0).max(360)),
  pitch: numberWithDefault(0, z.number().min(-90).max(90)),
  fov: numberWithDefault(80, z.number().min(10).max(120)),
  caption: emptyStringSchema,
  alt: emptyStringSchema,
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
  id: emptyStringSchema,
  countrySlug: slugSchema,
  slug: slugSchema,
  title: emptyStringSchema,
  coordinates: optionalCoordinatesSchema,
  summary: emptyStringSchema,
  minZoom: numberWithDefault(4, z.number().min(0).max(22)),
  tags: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(z.string().trim().min(1)),
  ),
  status: z.preprocess(
    (value) =>
      value === null || value === undefined || value === "" ? "draft" : value,
    z.enum(["draft", "published", "archived"]),
  ),
  streetViews: z.preprocess(
    (value) => (value === null || value === undefined ? [] : value),
    z.array(streetViewSchema),
  ),
});

export const locationSchema = rawLocationSchema.transform(
  (location, context) => {
    const firstStreetView = location.streetViews[0];
    const urlCoordinates = firstStreetView?.google_map_url
      ? firstStreetView.viewpoint
      : undefined;
    const coordinates =
      urlCoordinates ?? location.coordinates ?? firstStreetView?.viewpoint;

    if (location.status === "published") {
      const requiredTextFields = [
        ["id", location.id, "id"],
        ["countrySlug", location.countrySlug, "countrySlug"],
        ["slug", location.slug, "slug"],
        ["title", location.title, "title"],
        ["summary", location.summary, "summary"],
      ] as const;

      for (const [path, value, label] of requiredTextFields) {
        if (!value) {
          context.addIssue({
            code: "custom",
            path: [path],
            message: `published location 必须填写 ${label}`,
          });
        }
      }

      if (location.streetViews.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["streetViews"],
          message: "published location 至少需要一条 streetViews",
        });
      }

      location.streetViews.forEach((streetView, index) => {
        for (const [field, value] of [
          ["id", streetView.id],
          ["caption", streetView.caption],
          ["alt", streetView.alt],
        ] as const) {
          if (!value) {
            context.addIssue({
              code: "custom",
              path: ["streetViews", index, field],
              message: `published streetView 必须填写 ${field}`,
            });
          }
        }
      });
    }

    if (!coordinates && location.status === "published") {
      context.addIssue({
        code: "custom",
        path: ["coordinates"],
        message:
          "需要 coordinates，或在第一条 streetViews 中提供可解析的 google_map_url/viewpoint",
      });
      return z.NEVER;
    }

    return { ...location, coordinates: coordinates ?? ([0, 0] as [number, number]) };
  },
);

export type GeoLocation = z.output<typeof locationSchema>;
export type StreetView = z.output<typeof streetViewSchema>;

const locationsDirectory = resolve(process.cwd(), "src/data/locations");

const listLocationFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return listLocationFiles(entryPath);
      return entry.isFile() && entry.name.endsWith(".json") ? [entryPath] : [];
    })
    .sort();

const parseLocation = (filePath: string): GeoLocation => {
  const relativePath = relative(locationsDirectory, filePath).split(sep).join("/");
  const pathMatch = relativePath.match(/^([^/]+)\/([^/]+)\.json$/);
  if (!pathMatch) {
    throw new Error(
      `Invalid location file path: src/data/locations/${relativePath}`,
    );
  }

  const [, pathCountrySlug, pathSlug] = pathMatch;
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法解析 JSON";
    throw new Error(`Invalid JSON in src/data/locations/${relativePath}: ${message}`);
  }

  const rawValue =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const textOrEmpty = (field: unknown) =>
    typeof field === "string" ? field.trim() : "";
  const countrySlug = textOrEmpty(rawValue.countrySlug) || pathCountrySlug;
  const slug = textOrEmpty(rawValue.slug) || pathSlug;
  const id = textOrEmpty(rawValue.id) || `${countrySlug}_${slug}`;
  const title = textOrEmpty(rawValue.title);
  const streetViews = Array.isArray(rawValue.streetViews)
    ? rawValue.streetViews.map((streetView, index) => {
        const rawStreetView =
          streetView && typeof streetView === "object" && !Array.isArray(streetView)
            ? (streetView as Record<string, unknown>)
            : {};
        const fallbackLabel = title || slug;
        return {
          ...rawStreetView,
          id:
            textOrEmpty(rawStreetView.id) ||
            `${id}_view_${String(index + 1).padStart(2, "0")}`,
          caption: textOrEmpty(rawStreetView.caption) || fallbackLabel,
          alt: textOrEmpty(rawStreetView.alt) || fallbackLabel,
        };
      })
    : rawValue.streetViews;

  const result = locationSchema.safeParse({
    ...rawValue,
    id,
    countrySlug,
    slug,
    streetViews,
  });
  if (!result.success) {
    throw new Error(
      `Invalid location data in src/data/locations/${relativePath}: ${result.error.message}`,
    );
  }
  return result.data;
};

export const loadLocations = (): GeoLocation[] => {
  const parsedLocations = listLocationFiles(locationsDirectory).map(parseLocation);
  const ids = new Set<string>();
  const slugs = new Set<string>();

  for (const location of parsedLocations) {
    if (location.id && ids.has(location.id)) {
      throw new Error(`Duplicate location id: ${location.id}`);
    }
    if (location.id) ids.add(location.id);

    const scopedSlug = `${location.countrySlug}/${location.slug}`;
    if (location.countrySlug && location.slug && slugs.has(scopedSlug)) {
      throw new Error(`Duplicate location slug: ${scopedSlug}`);
    }
    if (location.countrySlug && location.slug) slugs.add(scopedSlug);
  }

  return parsedLocations.filter((location) => location.status === "published");
};
