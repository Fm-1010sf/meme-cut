# 部署

## 为什么不需要后端

解码、抽帧、量化、GIF 编码全在用户浏览器里完成。构建产物只有 4 个文件、420 KB，没有任何接口、数据库或环境变量。

这意味着托管只做一件事：把文件发给浏览器。任何静态托管都行，而且**托管方看不到任何用户视频**——隐私在架构上成立，不靠承诺。

产物：

```
dist/
  index.html                 1.3 KB
  assets/index-*.css        30 KB
  assets/index-*.js        390 KB  (gzip 128 KB)
  _headers                  Cloudflare / Netlify 的缓存头
```

---

## 路线 A · Cloudflare Pages（推荐）

免费、无需备案、自带 HTTPS 和全球 CDN、有 `*.pages.dev` 免费域名。改一行配置就能绑自定义域名。

### A1 命令行（我来跑，你点一下登录）

```bash
pnpm add -D wrangler
pnpm exec wrangler login        # 浏览器里授权，这一步只能你点
pnpm exec wrangler pages deploy dist --project-name=meme-cut
```

登录后会拿到 `https://meme-cut.pages.dev`。

### A2 网页拖拽

把 `dist/` 整个文件夹拖进 <https://app.netlify.com/drop> 或 Cloudflare 控制台的 Direct Upload。不用装任何东西，但要先登录。

### 速度预期

中国大陆访问 `*.pages.dev` 通常可用，速度不稳定——Cloudflare 的中国大陆节点需要企业合作，免费版走境外节点。**这是预测，没有实测过**，你那边网络说了算。

---

## 路线 B · 国内 CDN（要备案）

如果国内速度是硬指标，唯一可靠的路是：备案域名 + 阿里云 OSS / 腾讯云 COS + CDN。

- 速度最好，国内节点直连
- 成本：域名几十元/年 + 存储流量费（这个应用流量极小，基本可忽略）
- **代价：ICP 备案通常 1–3 周**，且需要主体资质
- 注意：国内对象存储用**默认域名**访问 HTML 会被强制下载而不是渲染，所以必须绑备案域名

---

## 路线 C · GitHub Pages（有仓库就行）

在仓库里加一个 workflow，push 即发布。不需要额外账号。

国内访问 `*.github.io` 慢且偶有不通，适合先跑起来，不适合长期给国内用户用。

---

## 上线前检查清单

- [x] 生产构建能跑：`vite build` 通过，端到端测试全绿
- [x] 移动端 390px 无横向溢出
- [x] 无控制台错误
- [ ] **真机 iOS Safari 实测**（当前所有验证都是 Edge 无头浏览器跑的）
- [ ] 微信实际添加一遍，确认 200×200 / 1MB 这两个数字还有效
- [ ] 用自己的手机加一张真的抖音表情，走完整条链路

最后三项没做完之前，别当成「任何人都能用」推出去——iPhone 上 seek 精度和 canvas 取帧的行为没验证过，这是最可能出问题的地方。
