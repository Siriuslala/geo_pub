const NUMBER_PATTERN = "-?\\d+(?:\\.\\d+)?";

const cameraPattern = new RegExp(
  `/@(${NUMBER_PATTERN}),(${NUMBER_PATTERN}),3a(?:,(${NUMBER_PATTERN})y)?(?:,(${NUMBER_PATTERN})h)?(?:,(${NUMBER_PATTERN})t)?`,
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
  const dataPanoId = decodedUrl.match(/!1s([^!/?#]+)!2e/i)?.[1];
  const panoId = embeddedPanoId ?? dataPanoId ?? null;

  const yaw = decodedUrl.match(yawPattern)?.[1];
  const cameraHeading = camera[4];
  const heading = normalizeHeading(Number(yaw ?? cameraHeading ?? 0));

  const embeddedPitch = decodedUrl.match(pitchPattern)?.[1];
  const cameraTilt = camera[5];
  const pitch = Number(
    embeddedPitch ?? (cameraTilt === undefined ? 0 : 90 - Number(cameraTilt)),
  );
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
