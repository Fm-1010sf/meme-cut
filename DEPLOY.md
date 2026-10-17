# 部署

## 已上线

```
https://fm-1010sf.github.io/meme-cut/
```

仓库：<https://github.com/Fm-1010sf/meme-cut>（公开）

**真实实测**（Edge 无头浏览器，从本机访问线上地址）：

| 指标 | 数值 |
| --- | --- |
| 首次绘制 | 约 2.0–2.2 秒 |
| DOM 就绪 | 约 1.9–2.1 秒 |
| 传输量 | 133 KB（gzip 后） |
| 端到端功能测试 | 全部通过 |
| 控制台错误 | 无 |

本机跑 `vite preview` 是 0.6 秒，线上 2 秒——**差在网络，不在代码**。
133 KB 从 Fastly 拉过来在国内就是这速度。想更快只能换国内 CDN（见路线 D）。

## 更新方式

改了代码推上去就行，Actions 会自动构建发布：

```bash
git push
```

一两分钟后线上更新。工作流在 `.github/workflows/deploy.yml`：
装依赖 → 类型检查 → `vite build` → 发 Pages。构建失败不会覆盖线上，旧版继续在。

## 这台机器上的两个坑（换机器要重做）

### 1. GitHub 必须走代理

`github.com` 的 443 端口在本机被墙（换 6 个 IP 全部超时），但 `github.io`、`api.github.com`
是通的。系统代理在 `127.0.0.1:7890`，所以：

- **浏览器**能打开 github.com（走系统代理）
- **命令行**默认不走，需要在仓库里单独配一次（已配好，写在 `.git/config`，不进版本库）：

```bash
git config --local http.proxy  http://127.0.0.1:7890
git config --local https.proxy http://127.0.0.1:7890
```

**注意**：这个配置只在本仓库有效。换机器或重新克隆后要再配一次，否则 `git push` 会超时。

### 2. npm 用国内镜像

`.npmrc` 里指向 npmmirror。换到能直连 npm 的网络时删掉这个文件即可。

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

Vite 的 `base` 是 `'./'`，所以同一份产物既能放域名根目录，也能放 `/仓库名/` 子路径。
已验证：放到 `/meme-cut/` 下跑完整端到端测试，全绿。

---

## 走过的弯路（留档，别再踩）

### Cloudflare 在国内不适合做入口

先部署到了 Cloudflare Workers 静态资源，面板显示 Ready，但国内打不开。
不是速度问题，是 DNS 污染——连续解析同一域名，每次返回不同 IP，全是别人的地址：

```
69.63.176.15    Facebook 段
69.50.221.20    Facebook 段
162.125.2.5     Dropbox
2a03:2880:f10f:83:face:b00c:0:25de   Facebook IPv6
```

各平台在本机的实测：

| 平台 | 结果 |
| --- | --- |
| GitHub Pages (`*.github.io`) | HTTP 200，0.53s |
| Netlify | HTTP 200，1.14s |
| Vercel | HTTP 200，1.38s |
| Cloudflare 主站 | 20s 超时，半页 |
| `*.workers.dev` | DNS 污染 |
| `*.pages.dev` | 解析失败 |

**结论：Cloudflare 免费域名在国内不可用作入口，除非绑自己的域名。**
那个 Worker 部署现在是多余的，可以在 Cloudflare 后台删掉。

### wrangler 的 OAuth 在这台机器上不可用

`wrangler login` 两次都报 `request_forbidden`（CSRF 不匹配），浏览器侧表现为
`localhost:8976` 拒绝连接。端口本身可绑定，是 OAuth 回调链路的问题。
用 API 令牌也没走通（Cloudflare 建令牌时报「未知错误，请检查电子邮件」）。
**这条线放弃。**

---

## 备选路线（如果 GitHub Pages 哪天也不通）

### 路线 A · Netlify

免费，实测 1.14s。登录后把 `dist` 拖进 <https://app.netlify.com/drop>，
或 CLI `netlify deploy --dir=dist --prod`。

### 路线 B · 给 Cloudflare Worker 绑自定义域名

保留已部署的 Cloudflare 版本，只换一个没被污染的域名指过去。需要自备域名（约 ¥50/年）。
风险：Cloudflare 边缘 IP 在国内本身就不稳。

### 路线 C · 国内 CDN（最稳，也最慢）

备案域名 + 阿里云 OSS / 腾讯云 COS + CDN。

- 速度最好，国内节点直连
- **代价：ICP 备案通常 1–3 周**，需要主体资质
- 注意：国内对象存储用默认域名访问 HTML 会被强制下载，必须绑备案域名

---

## 上线前检查清单

- [x] 生产构建能跑，端到端测试全绿
- [x] 产物可放子路径（已验证 `/meme-cut/`）
- [x] 移动端 390px 无横向溢出
- [x] 无控制台错误
- [x] 线上地址实测可访问，功能测试通过
- [ ] **真机 iOS Safari 跑一遍完整链路**（加载、裁剪、生成、保存到相册再到微信添加）
- [ ] 微信实际添加一遍，确认 200×200 / 1MB 这两个数字还有效
- [ ] 换一个没用过代理的网络访问一次，确认 github.io 没被污染
