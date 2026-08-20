const NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?";

// @lat,lng,Na,... — Na is camera height in metres (2a, 3a, ...), not a Street View mode flag.
const cameraPattern = new RegExp(
  `/@(${NUMBER_PATTERN}),(${NUMBER_PATTERN}),(?:${NUMBER_PATTERN})a(?:,(${NUMBER_PATTERN})y)?(?:,(${NUMBER_PATTERN})h)?(?:,(${NUMBER_PATTERN})t)?`,
  "i",
);
const pitchPattern = new RegExp(`[?&]pitch=(${NUMBER_PATTERN})`, "i");
const yawPattern = new RegExp(`[?&]yaw=(${NUMBER_PATTERN})`, "i");

export interface ParsedGoogleStreetViewUrl {
  coordinates: [number, number];
  panoId: string | null;
  heading: number;
  pitch: number;
  fov: number;
}

const decodeNestedUrl = (value: string) => {
  let decoded = value;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }

  return decoded;
};

const normalizeHeading = (heading: number) => ((heading % 360) + 360) % 360;

const encodeVarint = (value: number, bytes: number[]) => {
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
};

// User Photo Spheres use !2e10 and a short id (CIHM..., CIAB..., AF1Qip...).
// Street View Static API expects the protobuf ImageKey {type:10, id} as unpadded base64.
const encodeUserPanoId = (shortId: string, type = 10) => {
  const idBytes = Buffer.from(shortId, "utf8");
  const bytes: number[] = [0x08];
  encodeVarint(type, bytes);
  bytes.push(0x12);
  encodeVarint(idBytes.length, bytes);
  return Buffer.concat([Buffer.from(bytes), idBytes])
    .toString("base64")
    .replace(/=+$/, "");
};

const looksLikeEncodedPanoId = (panoId: string) => /^CAoS/i.test(panoId);
const looksLikeUserPanoId = (panoId: string) =>
  /^(CIHM|CIAB|AF1Qip)/i.test(panoId);

const normalizePanoId = (
  rawPanoId: string | null,
  panoType: number | null,
): string | null => {
  if (!rawPanoId) return null;
  if (looksLikeEncodedPanoId(rawPanoId)) return rawPanoId;
  if (panoType === 10 || looksLikeUserPanoId(rawPanoId)) {
    return encodeUserPanoId(rawPanoId, panoType && panoType > 0 ? panoType : 10);
  }
  return rawPanoId;
};

export const parseGoogleStreetViewUrl = (
  rawUrl: string,
): ParsedGoogleStreetViewUrl => {
  const cleanedUrl = rawUrl.trim().replace(/[。．]+$/u, "");
  let url: URL;

  try {
    url = new URL(cleanedUrl);
  } catch {
    throw new Error("不是有效的 URL");
  }

  if (!/(^|\.)google\.[a-z.]+$/i.test(url.hostname)) {
    throw new Error("必须使用完整的 Google Maps 链接");
  }

  const decodedUrl = decodeNestedUrl(url.href);
  const camera = decodedUrl.match(cameraPattern);

  if (!camera) {
    throw new Error("链接中没有找到 Street View 经纬度和镜头参数");
  }

  const latitude = Number(camera[1]);
  const longitude = Number(camera[2]);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("链接中的经纬度超出有效范围");
  }

  const embeddedPanoId = decodedUrl.match(/[?&]panoid=([^&!?#]+)/i)?.[1];
  const dataPano = decodedUrl.match(/!1s([^!/?#]+)!2e(\d+)/i);
  const panoId = normalizePanoId(
    embeddedPanoId ?? dataPano?.[1] ?? null,
    dataPano?.[2] ? Number(dataPano[2]) : null,
  );

  const yaw = decodedUrl.match(yawPattern)?.[1];
  const cameraHeading = camera[4];
  const heading = normalizeHeading(Number(yaw ?? cameraHeading ?? 0));

  const embeddedPitch = decodedUrl.match(pitchPattern)?.[1];
  const cameraTilt = camera[5];
  // Maps URLs use an inverted vertical axis: 90t is the horizon, larger t
  // looks up, smaller t looks down. Thumbnail `pitch=` is `90 - t`. Street
  // View Static API is the opposite sign (positive looks up).
  const mapsPitch = Number(
    embeddedPitch ?? (cameraTilt === undefined ? 0 : 90 - Number(cameraTilt)),
  );
  const pitch = -mapsPitch;
  if (!Number.isFinite(pitch) || pitch < -90 || pitch > 90) {
    throw new Error("链接中的俯仰角超出有效范围");
  }

  const fov = Number(camera[3] ?? 80);
  if (!Number.isFinite(fov) || fov < 10 || fov > 120) {
    throw new Error("链接中的视野角超出有效范围");
  }

  return {
    coordinates: [longitude, latitude],
    panoId,
    heading,
    pitch,
    fov,
  };
};
