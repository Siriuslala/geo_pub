# Geo Pub

以交互式世界地图为入口的个人图寻资料库，目标站点：

```text
https://siriuslala.github.io/geo_pub/
```

当前首版包含：

- 可拖拽、缩放并横向循环的 MapLibre 世界地图；
- 默认使用地形模式，并可切换到简洁模式；
- 可点击的美国国家区域和国家名称；
- location 聚合、hover 延迟和可固定的信息浮层；
- Street View Static API 多图预览；
- 点击街景图跳转 Google Maps 官方街景；
- 移动端底部地点面板；
- 美国静态资料页和两个示例 location；
- GitHub Pages 自动部署工作流。

完整产品和数据设计见 [DESIGN.md](./DESIGN.md)。

## 本地运行

要求 Node.js 22 和 npm 10 或更新版本。

```bash
npm install
cp .env.example .env
npm run dev
```

默认地址：

```text
http://localhost:4321/geo_pub/
```

没有 Google API Key 时项目仍可运行。地图、国家页、location 摘要和 Google Maps 外链均正常；街景图片区域显示未连接状态。

检查和构建：

```bash
npm run check
npm run build
npm run preview
```

## 配置 Street View Static API

需要一个 Google 账号和 Google Cloud 项目。

1. 打开 [Google Maps Platform](https://console.cloud.google.com/google/maps-apis/start)。
2. 创建或选择一个 Google Cloud Project。
3. 为项目绑定结算账号。Static API 即使在免费额度内也要求启用结算。
4. 启用 `Street View Static API`。
5. 创建一个 API Key。
6. Application restrictions 选择 `Websites` / HTTP referrers。
7. API restrictions 选择只允许 `Street View Static API`。
8. 设置配额和预算告警。

建议允许的 referrer：

```text
http://localhost:4321/*
https://siriuslala.github.io/geo_pub/*
```

把 Key 写入本地 `.env`，不要提交 `.env`：

```bash
PUBLIC_GOOGLE_MAPS_API_KEY=your_restricted_browser_key
```

生产部署时，在 GitHub 仓库中进入：

```text
Settings → Secrets and variables → Actions → New repository secret
```

创建：

```text
Name: PUBLIC_GOOGLE_MAPS_API_KEY
Value: 受限制的 API Key
```

Key 会进入浏览器发出的 Google 图片请求，因此“把 Key 放入 GitHub Secret”不能让最终 Key 对访客不可见。真正的保护来自 HTTP referrer 限制、API 范围限制和配额限制。

当前原型支持受限 API Key，但还没有生成 Google 建议的 URL 数字签名。签名 Secret 不能进入客户端；后续应在 GitHub Actions 构建阶段为固定街景请求生成签名。

官方当前价格：Static Street View 每月前 10,000 次成功图片加载免费，超出后的全球首档价格为 `$7/1000` 次。价格可能变化，以 [官方价格表](https://developers.google.com/maps/billing-and-pricing/pricing#map-loads-pricing) 为准。

## 添加一个 location

一个 location 对应一个 JSON 文件。例如：

```text
src/data/locations/united_states/arizona_saguaro.json
```

基本结构：

```json
{
  "id": "us_arizona_example_001",
  "countrySlug": "united_states",
  "slug": "arizona_example",
  "title": "Arizona · Example",
  "summary": "这里填写地点的街景特征总结。",
  "minZoom": 4,
  "tags": ["植被", "道路"],
  "status": "published",
  "streetViews": [
    {
      "id": "arizona_example_view_01",
      "google_map_url": "粘贴完整的 Google Maps Street View 链接",
      "local_image_path": "images/locations/united_states/arizona_example.webp",
      "caption": "用于图片链接无障碍标签的简短说明，不直接显示",
      "alt": "对该街景画面的可访问性描述"
    }
  ]
}
```

`google_map_url` 非空时，构建过程会自动提取经纬度、`panoId`、
`heading`、`pitch` 和 `fov`。第一张街景的经纬度也会成为地图点位坐标，
因此不需要再填写顶层 `coordinates`。链接无法解析时构建会直接报错。

需要暂时使用手填参数时，把 `google_map_url` 设为 `""`，并继续提供
`coordinates`、`viewpoint`、`panoId`、`heading`、`pitch` 和 `fov`。

“谷歌 / 國內”开关默认使用 Google Street View Static API。切换到“國內”
后只读取 `local_image_path`，不会创建 Google 图片请求。本地图应放在
`public/images/locations/`，JSON 路径相对于 `public/`，推荐使用 16:9 的
WebP 或 JPEG。没有本地图时将字段设为 `""`，卡片会显示待添加状态。

项目内部坐标顺序始终是：

```text
[经度, 纬度]
[longitude, latitude]
```

构建代码会自动转换成 Google API 需要的 `纬度,经度`。

新增 JSON 后运行：

```bash
npm run check
```

Zod schema 会检查坐标范围、slug、状态、镜头参数和必填内容。发布状态设为 `draft` 时，点位不会进入生产地图。

## 国家资料

美国正文位于：

```text
src/content/countries/united_states.md
```

国家页面位于：

```text
src/pages/united_states/index.astro
```

后续会把国家页面进一步抽象成统一的静态路由生成器，使新增国家只需要增加 Markdown 和国家元数据。

## 部署

仓库包含 `.github/workflows/deploy.yml`。推送到 `main` 后，GitHub Actions 会：

1. 安装依赖；
2. 运行 Astro 类型和内容检查；
3. 以 `/geo_pub/` 为基础路径构建静态站；
4. 部署到 GitHub Pages。

第一次部署前，在 GitHub 仓库的 `Settings → Pages` 中把 Source 设置为 `GitHub Actions`。

## 街景版权边界

Google Street View 图片只由 Google API 在线返回。不要截图后提交到仓库，也不要上传到 R2。自有或已授权图片可以放在 `public/images/locations/`，数量显著增长后再迁移到对象存储。
