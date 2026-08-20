import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

const coordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

const isoNumericSchema = z
  .union([z.string(), z.number().int().nonnegative()])
  .transform((value) => String(value).padStart(3, "0"))
  .pipe(z.string().regex(/^\d{3}$/, "isoNumeric 必须是三位数字"));

const updatedAtSchema = z
  .union([z.string(), z.date()])
  .transform((value) => {
    const serialized = value instanceof Date ? value.toISOString() : value;
    return serialized.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? serialized;
  })
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "updatedAt 必须是 YYYY-MM-DD"));

const countryFrontmatterSchema = z.object({
  title: z.string().min(1),
  nameZh: z.string().min(1),
  iso2: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((value) => value.toUpperCase()),
  isoNumeric: isoNumericSchema,
  mapCenter: coordinatesSchema,
  summary: z.string().min(1),
  updatedAt: updatedAtSchema,
});

const countriesDirectory = resolve(process.cwd(), "src/content/countries");
const slugPattern = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

const parseFrontmatterValue = (raw: string): unknown => {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value.startsWith("[")) return JSON.parse(value);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
};

const parseCountryFile = (fileName: string) => {
  const slug = fileName.replace(/\.md$/, "");
  if (!slugPattern.test(slug)) {
    throw new Error(`Invalid country filename: src/content/countries/${fileName}`);
  }

  const source = readFileSync(resolve(countriesDirectory, fileName), "utf8");
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error(
      `Invalid country markdown in src/content/countries/${fileName}: missing YAML frontmatter`,
    );
  }

  const rawData: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator === -1) {
      throw new Error(
        `Invalid country frontmatter in src/content/countries/${fileName}: ${line}`,
      );
    }
    rawData[line.slice(0, separator).trim()] = parseFrontmatterValue(
      line.slice(separator + 1),
    );
  }

  const result = countryFrontmatterSchema.safeParse(rawData);
  if (!result.success) {
    throw new Error(
      `Invalid country data in src/content/countries/${fileName}: ${result.error.message}`,
    );
  }

  return {
    slug,
    html: renderMarkdown(match[2]),
    ...result.data,
  };
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const renderInline = (value: string) =>
  escapeHtml(value)
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const renderMarkdown = (markdown: string) => {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].startsWith(">")) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      html.push(`<blockquote><p>${renderInline(quote.join(" "))}</p></blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(
          `<li>${renderInline(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`,
        );
        index += 1;
      }
      html.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("#") &&
      !lines[index].startsWith(">") &&
      !/^\s*[-*]\s+/.test(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
};

export const loadCountryNotes = () => {
  const notes = readdirSync(countriesDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .sort()
    .map(parseCountryFile);

  const isoNumericIds = new Set<string>();
  const iso2Ids = new Set<string>();
  for (const country of notes) {
    if (isoNumericIds.has(country.isoNumeric)) {
      throw new Error(`Duplicate country isoNumeric: ${country.isoNumeric}`);
    }
    if (iso2Ids.has(country.iso2)) {
      throw new Error(`Duplicate country iso2: ${country.iso2}`);
    }
    isoNumericIds.add(country.isoNumeric);
    iso2Ids.add(country.iso2);
  }

  return notes;
};

export const loadCountryMapPages = () =>
  loadCountryNotes().map(({ slug, iso2, isoNumeric, title, nameZh }) => ({
    slug,
    iso2,
    isoNumeric,
    title,
    nameZh,
  }));

export type CountryNote = ReturnType<typeof loadCountryNotes>[number];
export type CountryMapPage = ReturnType<typeof loadCountryMapPages>[number];

export const getCountryNote = (slug: string) =>
  loadCountryNotes().find((country) => country.slug === slug);
