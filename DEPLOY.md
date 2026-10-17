# 部署

## 现状（2026-10）

已经部署到 Cloudflare Workers 静态资源：

```
https://meme-cut.2020855575.workers.dev
```

面板显示 **Ready**，部署是成功的。**但国内打不开。**

原因不是速度，是 `workers.dev` 这个域名在国内被 DNS 污染。实测本机连续解析同一个域名，
每次返回的 IP 都不同，且全是别人的地址：

```
69.63.176.15    Facebook 段（GFW 污染常用假地址）
69.50.221.20    Facebook 段
103.214.168.106
74.86.151.162
162.125.2.5     Dropbox
2a03:2880:f10f:83:face:b00c:0:25de   Facebook IPv6
```

拿到假 IP 自然连不上：`curl` 直接 443 超时。

## 各平台在本机的实测（同一台机器、同一网络）

| 平台 | 结果 |
| --- | --- |
| GitHub Pages (`*.github.io`) | HTTP 200，**0.56s**，DNS 返回真实 IP 段 185.199.108-111 |
| Netlify (`*.netlify.app`) | HTTP 200，1.14s |
| Vercel (`*.vercel.app`) | HTTP 200，1.38s |
| Cloudflare 主站 | HTTP 200 但 20 秒超时，页面只收了一半 |
| Cloudflare `*.workers.dev` | DNS 污染，连不上 |
| Cloudflare `*.pages.dev` | 解析失败 |

结论：**Cloudflare 这条线在国内不适合做入口**，除非绑自己的域名。

## 为什么不需要后端

解码、抽帧、量化、GIF 编码全在用户浏览器里完成。构建产物只有 5 个文件、约 420 KB，
没有任何接口、数据库或环境变量。

托管只做一件事：把文件发给浏览器。**托管方看不到任何用户视频**——隐私在架构上成立，不靠承诺。

产物：

```
dist/
  index.html                1.3 KB
  assets/index-*.js       392 KB  (gzip 130 KB)
  assets/index-*.css       29 KB  (gzip 5.9 KB)
  _headers                 Cloudflare / Netlify 的缓存头
  .nojekyll                阻止 GitHub Pages 跑 Jekyll
```

## 产物是可移植的

Vite 的 `base` 设成了 `'./'`，所以同一份 `dist/` 既能放域名根目录，也能放 `/仓库名/` 子路径。
已验证：把产物放到 `/meme-cut/` 下跑完整端到端测试，全绿，首屏 597ms。
**不用为每个平台重新打包。**

---

## 路线 A · GitHub Pages（推荐）

本机实测最快，免费，不需要域名。

1. 建一个 **Public** 仓库（名字例如 `meme-cut`）
2. 把 `dist/` 里的**所有文件**传上去（网页支持直接拖拽）——注意是 `index.html` 这一层，不是外层文件夹
3. 仓库 **Settings → Pages → Source: Deploy from a branch → main → / (root)**
4. 等一分钟，地址是 `https://<用户名>.github.io/<仓库名>/`

适用前提：`*.github.io` 在被污染名单之外。实测通过，但这类名单会变，上线后要自己验一次。

## 路线 B · 给现有 Worker 绑自定义域名

保留已经部署好的 Cloudflare 版本，只是换一个没被污染的域名指过去。

- 需要你拥有一个域名（约 ¥50/年）
- 域名托管到 Cloudflare，然后在 Worker 的 Settings → Domains & Routes 里绑定
- 好处：Cloudflare 的 CDN 和 HTTPS 都是现成的
- 风险：Cloudflare 的边缘 IP 在国内本身就不稳（测得主站 20 秒超时），域名没被污染也可能慢

## 路线 C · Netlify

免费，实测 1.14s，同样不需要域名。

- 登录后把 `dist` 拖进 <https://app.netlify.com/drop>
- 或者用 CLI：`netlify deploy --dir=dist --prod`

## 路线 D · 国内 CDN（最稳，也最慢）

如果访问速度和稳定性是硬指标，唯一可靠的是备案域名 + 阿里云 OSS / 腾讯云 COS + CDN。

- 速度最好，国内节点直连
- 成本：域名 + 存储流量（这个应用流量极小，基本可忽略）
- **代价：ICP 备案通常 1–3 周**，需要主体资质
- 注意：国内对象存储用默认域名访问 HTML 会被强制下载，必须绑备案域名

---

## 上线前检查清单

- [x] 生产构建能跑，端到端测试全绿
- [x] 产物可放子路径（已验证 `/meme-cut/`）
- [x] 移动端 390px 无横向溢出
- [x] 无控制台错误
- [ ] **真机 iOS Safari 实测**（当前验证是 Edge 无头浏览器 + 你自己的 iPhone 手动试过加载，但完整链路没在 iOS 上跑过）
- [ ] 微信实际添加一遍，确认 200×200 / 1MB 这两个数字还有效
- [ ] 部署后从国内网络打开一次，确认域名没被污染
