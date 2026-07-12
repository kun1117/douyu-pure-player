/**
 * 斗鱼直播纯净播放器 - 后端服务器
 *
 * 功能：
 *   1. 封装 dy_api.ts 的流地址获取逻辑
 *   2. 提供 REST API 供前端调用
 *   3. 代理 FLV 流解决跨域问题
 *   4. 托管前端静态页面
 *
 * 启动：npm start  →  http://localhost:3000
 */

import crypto from "node:crypto";
import express from "express";
import safeEval from "safe-eval";
import queryString from "query-string";
import axios from "axios";

/* ================================================================
 *  配置
 * ================================================================ */
const PORT = process.env.PORT || 3000;
const app = express();

app.use(express.static("public"));

// 斗鱼用来检测是否浏览器的 Proxy
const disguisedNativeMethods = new Proxy(
  {},
  { get: () => "function () { [native code] }" },
);

/* ================================================================
 *  工具函数
 * ================================================================ */

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/* ================================================================
 *  斗鱼签名函数缓存
 *
 *  斗鱼的 getH5Play 接口需要签名参数 auth_params，
 *  签名函数通过 homeH5Enc 接口返回的 JS 代码 + safe-eval 生成。
 *  拿到后缓存下来，避免每次请求都重新拉取。
 * ================================================================ */

const signFnCache = new Map();

async function getSignFn(roomId, rejectCache = false) {
  if (!rejectCache && signFnCache.has(roomId)) {
    return signFnCache.get(roomId);
  }

  const res = await axios.get(
    `https://www.douyu.com/swf_api/homeH5Enc?rids=${roomId}`,
    { headers: { "User-Agent": "Mozilla/5.0" } },
  );

  const json = res.data;
  if (json.error !== 0) {
    throw new Error(`homeH5Enc 返回错误: ${json.error}`);
  }

  const code = json.data && json.data[`room${roomId}`];
  if (!code) {
    throw new Error(`未找到房间 ${roomId} 的签名代码`);
  }

  // 把斗鱼返回的 JS 代码封装成可调用的函数
  const sign = safeEval(
    `(function func(a,b,c){${code};return ub98484234(a,b,c)})`,
    {
      CryptoJS: {
        MD5: (str) => crypto.createHash("md5").update(str).digest("hex"),
      },
      window: disguisedNativeMethods,
      document: disguisedNativeMethods,
    },
  );

  signFnCache.set(roomId, sign);
  return sign;
}

/* ================================================================
 *  核心：获取直播流信息
 *
 *  返回：
 *    { living: false }                     — 未开播
 *    { living: true, currentStream: {...} } — 直播中
 *
 *  currentStream.url 就是 flv.js 要播放的地址
 * ================================================================ */

async function getLiveInfo(roomId, opts = {}) {
  const { cdn = "", rate = 0, onlyAudio = false, rejectSignFnCache = false } = opts;

  // Step 1: 获取签名函数并计算签名
  const sign = await getSignFn(roomId, rejectSignFnCache);
  const did = uuid().replace(/-/g, "");
  const time = Math.ceil(Date.now() / 1000);
  const signedStr = String(sign(roomId, did, time));
  const signed = queryString.parse(signedStr);

  // Step 2: 调用 getH5Play 接口
  const params = new URLSearchParams({
    ...signed,
    cdn,
    rate: String(rate),
    fa: onlyAudio ? "1" : "0",
  });

  const res = await axios.post(
    `https://www.douyu.com/lapi/live/getH5Play/${roomId}`,
    params.toString(),
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.douyu.com/",
      },
    },
  );

  if (res.status !== 200) {
    // 鉴权失败 -> 清除缓存重试一次
    if (res.status === 403 && res.data === "鉴权失败" && !rejectSignFnCache) {
      signFnCache.delete(roomId);
      return getLiveInfo(roomId, { ...opts, rejectSignFnCache: true });
    }
    throw new Error(`HTTP ${res.status}: ${typeof res.data === "string" ? res.data : "请求失败"}`);
  }

  const json = res.data;

  // 未开播/被封禁/不存在
  if ([-3, -4, -5].includes(json.error)) {
    return { living: false };
  }

  if (json.error !== 0) {
    if (json.error === -9) signFnCache.delete(roomId); // 时间戳错误，清除缓存
    throw new Error(`getH5Play 返回错误: ${json.error}`);
  }

  // Step 3: 拼接流地址
  const streamUrl = `${json.data.rtmp_url}/${json.data.rtmp_live}`;

  let cdnName = json.data.rtmp_cdn;
  try {
    const url = new URL(streamUrl);
    cdnName = url.searchParams.get("fcdn") ?? cdnName;
  } catch {
    // 忽略 URL 解析错误
  }

  return {
    living: true,
    sources: json.data.cdnsWithName,     // CDN 源列表
    streams: json.data.multirates,        // 清晰度列表
    isSupportRateSwitch: json.data.rateSwitch === 1,
    isOriginalStream: json.data.rateSwitch !== 1,
    online: json.data.online,             // 在线人数
    currentStream: {
      source: cdnName,
      name:
        json.data.rateSwitch !== 1
          ? "原画"
          : (json.data.multirates.find((r) => r.rate === json.data.rate)
              ?.name ?? "未知"),
      rate: json.data.rate,
      url: streamUrl,
    },
  };
}

/* ================================================================
 *  获取房间信息（直播间标题、主播名、状态等）
 * ================================================================ */

async function getRoomInfo(roomId) {
  const res = await axios.get(`https://www.douyu.com/betard/${roomId}`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return res.data;
}

/* ================================================================
 *  API 路由
 * ================================================================ */

/**
 * GET /api/live/:roomId
 *
 * 返回直播流信息（含 FLV 地址）
 *
 * 参数：
 *   ?cdn=ws    — 指定 CDN（可选）
 *   ?rate=0    — 清晰度（0=原画, 1=流畅, 2=高清, 3=超清, 4=蓝光）
 *
 * 返回：
 *   { living: true/false, currentStream: { url, name, ... }, ... }
 */
app.get("/api/live/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    const { cdn, rate } = req.query;

    const result = await getLiveInfo(roomId, {
      cdn: cdn || "",
      rate: rate ? parseInt(rate) : 0,
    });

    res.json(result);
  } catch (err) {
    console.error(`[ERROR] /api/live/${req.params.roomId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/room/:roomId
 *
 * 返回直播间基本信息（标题、主播、状态等）
 */
app.get("/api/room/:roomId", async (req, res) => {
  try {
    const info = await getRoomInfo(req.params.roomId);
    res.json(info);
  } catch (err) {
    console.error(`[ERROR] /api/room/${req.params.roomId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/proxy
 *
 * 代理 FLV 流，解决跨域问题（如果斗鱼 CDN 不支持 CORS）
 *
 * 用法：/api/proxy?url=https://...flv地址
 */
app.get("/api/proxy", async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: "缺少 url 参数" });

    const response = await axios.get(url, {
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.douyu.com/",
      },
    });

    res.setHeader("Content-Type", response.headers["content-type"] || "video/x-flv");
    res.setHeader("Access-Control-Allow-Origin", "*");
    response.data.pipe(res);
  } catch (err) {
    console.error(`[ERROR] /api/proxy:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ================================================================
 *  启动
 * ================================================================ */

app.listen(PORT, () => {
  console.log(`\n  🎯 斗鱼纯净播放器已启动`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  本地访问:  http://localhost:${PORT}`);
  console.log(`  API 示例:  http://localhost:${PORT}/api/live/6`);
  console.log(`  房间信息:  http://localhost:${PORT}/api/room/6`);
  console.log(`\n  打开浏览器访问上面地址即可使用\n`);
});
