(() => {
  "use strict";

  const POLL_MS = 10_000;       // số đo mới nhất
  const HISTORY_MS = 60_000;    // lịch sử + biểu đồ
  // shortcut: "Tất cả dữ liệu" chỉ tải được 50.000 mẫu mới nhất (cap của API), khi DB vượt mốc này sẽ phải nâng limit backend
  const HISTORY_LIMIT = 50_000;
  const $ = (id) => document.getElementById(id);

  const state = {
    averageWindow: 24,
    historyRange: "all",
    history: [],
    historyLoadedAt: 0,
    toastTimer: null
  };

  // threshold = ngưỡng cảnh báo TCVN — chỉ các thông số này có gauge
  const METRICS = [
    { key: "pm1_0", digits: 0, unit: "µg/m³" },
    { key: "pm2_5", digits: 0, unit: "µg/m³", threshold: 50, name: "PM2.5" },
    { key: "pm10", digits: 0, unit: "µg/m³", threshold: 100, name: "PM10" },
    { key: "co2", digits: 0, unit: "ppm", threshold: 1000, name: "CO₂" },
    { key: "temperature", digits: 1, unit: "°C" },
    { key: "humidity", digits: 1, unit: "%" }
  ];
  const LIMITS = METRICS.filter((metric) => metric.threshold !== undefined);

  // dải màu trên mặt gauge, tính theo lần ngưỡng (thang mặt gauge = 2× ngưỡng)
  const GAUGE_BANDS = [
    { to: 1, color: "#2e9e63", word: "An toàn" },
    { to: 1.5, color: "#e0a63c", word: "Vượt ngưỡng" },
    { to: 2, color: "#c84c4c", word: "Nguy hiểm" }
  ];

  function numberFormat(value, digits = 1) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(Number(value));
  }

  function dateFormat(value, withSeconds = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {})
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>\"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
  }

  async function apiGet(url) {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`Máy chủ trả về dữ liệu không hợp lệ (${response.status}).`); }
    if (!response.ok || body.success === false) throw new Error(body.message || `HTTP ${response.status}`);
    return body;
  }

  function setConnection(status, label) {
    const element = $("connection-state");
    element.classList.remove("is-online", "is-offline", "is-loading");
    element.classList.add(`is-${status}`);
    $("connection-label").textContent = label;
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
  }

  function renderLatest(reading) {
    let worst = { band: -1, text: "" };
    for (const { key, digits, unit, threshold, name } of METRICS) {
      const element = $(`value-${key}`);
      const raw = reading?.[key];
      const value = raw === null || raw === undefined ? NaN : Number(raw);
      const ok = Number.isFinite(value);
      element.textContent = numberFormat(value, digits);

      // kim gauge chỉ trên dải màu; phân loại theo vùng kim đang chỉ
      const needle = $(`gauge-${key}`)?.querySelector(".gauge-needle");
      const card = $(`gauge-${key}`)?.closest(".gauge-card");
      if (needle && card) {
        const band = ok ? (value <= threshold ? 0 : value <= threshold * 1.5 ? 1 : 2) : -1;
        needle.style.visibility = ok ? "visible" : "hidden";
        if (ok) needle.setAttribute("transform", `rotate(${(-90 + Math.min(2, value / threshold) / 2 * 180).toFixed(1)} 100 100)`);
        card.className = `gauge-card ${["is-ok", "is-warn", "is-bad"][band] ?? ""}`.trimEnd();
        $(`state-${key}`).textContent = ok ? GAUGE_BANDS[band].word : "—";
        if (band > worst.band) worst = { band, text: `${name} ${numberFormat(value, digits)} ${unit} (ngưỡng ${numberFormat(threshold, 0)} ${unit})` };
      }
    }
    const verdict = $("verdict");
    verdict.className = `verdict ${["is-ok", "is-warn", "is-bad"][worst.band] ?? "is-idle"}`;
    $("verdict-word").textContent = worst.band < 0 ? "Chờ dữ liệu" : GAUGE_BANDS[worst.band].word;
    $("verdict-text").textContent = worst.band < 0
      ? "Đang chờ mẫu đo đầu tiên từ cảm biến."
      : `Chỉ số cao nhất: ${worst.text}.`;
    $("sample-time").textContent = reading
      ? `Thời điểm đo: ${dateFormat(reading.measured_at)}`
      : "Chưa nhận mẫu đo";
  }

  function renderAverages(summary) {
    const complete = summary?.complete === true;
    for (const { key, threshold, unit } of LIMITS) {
      const value = summary?.averages?.[key];
      const known = value !== null && value !== undefined;
      $(`average-${key}`).textContent = known ? `${numberFormat(value, 1)} ${unit}` : "—";

      const pill = $(`status-${key}`);
      const over = complete && known && Number(value) > threshold;
      pill.className = `status-pill ${complete && known ? (over ? "status-bad" : "status-good") : "status-pending"}`;
      pill.textContent = !complete || !known ? "Đang tích lũy dữ liệu" : over ? "Vượt ngưỡng" : "Trong ngưỡng";
    }
    const hours = state.averageWindow;
    $("average-footnote").textContent = complete
      ? `Cửa sổ ${hours} giờ đã đủ dữ liệu · ${numberFormat(summary.sample_count, 0)} mẫu.`
      : `Chưa đủ dữ liệu bao phủ trọn cửa sổ ${hours} giờ — chưa kết luận.`;
  }

  function renderAlerts(alerts) {
    const list = Array.isArray(alerts) ? alerts : [];
    const activeCount = list.filter((item) => item.status === "active").length;
    $("active-alert-count").textContent = `${activeCount} đang hoạt động`;

    if (list.length === 0) {
      $("alerts-list").innerHTML = '<p class="empty-state">Chưa có sự kiện cảnh báo.</p>';
      return;
    }

    const label = { pm2_5: "PM2.5", pm10: "PM10", co2: "CO₂" };
    $("alerts-list").innerHTML = list.slice(0, 10).map((item) => {
      const active = item.status === "active";
      const unit = item.parameter === "co2" ? "ppm" : "µg/m³";
      return `<article class="alert-item">
        <div class="alert-item-top">
          <span class="alert-title">${escapeHtml(label[item.parameter] || item.parameter)} · cửa sổ ${escapeHtml(item.window_hours)} giờ</span>
          <span class="alert-state ${active ? "active" : "resolved"}">${active ? "Đang hoạt động" : "Đã kết thúc"}</span>
        </div>
        <div class="alert-detail">Trung bình ${numberFormat(item.average_value, 1)} ${unit} / ngưỡng ${numberFormat(item.threshold_value, 0)} ${unit}</div>
        <div class="alert-time">${dateFormat(item.created_at)}</div>
      </article>`;
    }).join("");
  }

  function renderHistoryTable(readings) {
    const rows = readings.slice(-20).reverse();
    $("history-count").textContent = `${numberFormat(readings.length, 0)} mẫu`;
    if (rows.length === 0) {
      $("readings-table-body").innerHTML = '<tr><td colspan="7" class="empty-cell">Chưa có dữ liệu trong khoảng thời gian này.</td></tr>';
      return;
    }
    $("readings-table-body").innerHTML = rows.map((item) => `
      <tr>
        <td>${escapeHtml(dateFormat(item.measured_at))}</td>
        <td>${numberFormat(item.pm1_0, 1)}</td>
        <td>${numberFormat(item.pm2_5, 1)}</td>
        <td>${numberFormat(item.pm10, 1)}</td>
        <td>${numberFormat(item.co2, 0)}</td>
        <td>${numberFormat(item.temperature, 1)}</td>
        <td>${numberFormat(item.humidity, 1)}</td>
      </tr>`).join("");
  }

  function drawLineChart(canvasId, readings, field, color, unit) {
    const canvas = $(canvasId);
    if (!canvas) return;

    const width = Math.max(260, canvas.clientWidth || 260);
    const height = 210;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const valid = readings.filter((item) => item[field] !== null && item[field] !== undefined && Number.isFinite(Number(item[field])));
    if (valid.length === 0) {
      ctx.fillStyle = "#98a3b2";
      ctx.font = "12px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Chưa có dữ liệu", width / 2, height / 2);
      return;
    }

    // Rút gọn khi vẽ; bảng và database vẫn giữ nguyên mẫu gốc.
    const points = [];
    const stride = Math.max(1, Math.ceil(valid.length / 240));
    for (let index = 0; index < valid.length; index += stride) points.push(valid[index]);
    if (points[points.length - 1] !== valid[valid.length - 1]) points.push(valid[valid.length - 1]);

    const values = points.map((item) => Number(item[field]));
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) { min = Math.max(0, min - 1); max += 1; }
    const spread = max - min;
    min = Math.max(0, min - spread * 0.12);
    max += spread * 0.12;

    const pad = { top: 12, right: 10, bottom: 27, left: 43 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;

    ctx.font = "10px system-ui";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "#edf1f5";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotHeight * i / 4);
      const value = max - ((max - min) * i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = "#8d99a9";
      ctx.fillText(numberFormat(value, 0), pad.left - 7, y);
    }

    ctx.beginPath();
    points.forEach((item, index) => {
      const x = pad.left + (points.length === 1 ? plotWidth / 2 : plotWidth * index / (points.length - 1));
      const y = pad.top + ((max - Number(item[field])) / (max - min)) * plotHeight;
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    ctx.fillStyle = "#8d99a9";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillText(dateFormat(points[0]?.measured_at, false), pad.left, height - 5);
    ctx.textAlign = "right";
    ctx.fillText(dateFormat(points[points.length - 1]?.measured_at, false), width - pad.right, height - 5);
    ctx.textAlign = "center";
    ctx.fillText(unit, width / 2, 10);
  }

  function renderCharts(readings) {
    drawLineChart("chart-pm1_0", readings, "pm1_0", "#8193ac", "µg/m³");
    drawLineChart("chart-pm2_5", readings, "pm2_5", "#3977d5", "µg/m³");
    drawLineChart("chart-pm10", readings, "pm10", "#129b91", "µg/m³");
    drawLineChart("chart-co2", readings, "co2", "#dd8b35", "ppm");
  }

  function getRangeStart(range) {
    if (range === "all") return new Date(0);
    const duration = ({
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "5d": 5 * 24 * 60 * 60 * 1000
    })[range] || 24 * 60 * 60 * 1000;
    return new Date(Date.now() - duration);
  }

  async function loadLive() {
    const [latest, averages, alerts] = await Promise.all([
      apiGet("/api/readings/latest"),
      apiGet(`/api/readings/averages?window=${state.averageWindow}`),
      apiGet("/api/alerts?limit=10")
    ]);
    renderLatest(latest.data);
    renderAverages(averages.data);
    renderAlerts(alerts.data);

    const received = latest.data?.received_at;
    if (!received) {
      setConnection("online", "Máy chủ hoạt động");
      $("poll-status").textContent = "Backend sẵn sàng, đang chờ ESP32 gửi dữ liệu";
      return;
    }
    const age = Math.max(0, (Date.now() - new Date(received).getTime()) / 1000);
    setConnection(age > 45 ? "offline" : "online", age > 45 ? "Dữ liệu đang trễ" : "Đang hoạt động");
    $("poll-status").textContent = age > 45
      ? `Mẫu cuối cách đây ${numberFormat(age, 0)} giây`
      : "Tự động cập nhật mỗi 10 giây";
  }

  async function loadHistory() {
    const from = getRangeStart(state.historyRange);
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: new Date().toISOString(),
      limit: String(HISTORY_LIMIT)
    });
    const result = await apiGet(`/api/readings/history?${query}`);
    state.history = Array.isArray(result.data) ? result.data : [];
    state.historyLoadedAt = Date.now();
    renderHistoryTable(state.history);
    renderCharts(state.history);
  }

  async function refreshAll(showMessage = false) {
    const button = $("refresh-button");
    button.disabled = true;
    setConnection("loading", "Đang cập nhật");
    try {
      await Promise.all([loadLive(), loadHistory()]);
      if (showMessage) showToast("Đã cập nhật dữ liệu.");
    } catch (error) {
      console.error(error);
      setConnection("offline", "Không kết nối được");
      $("poll-status").textContent = "Kiểm tra Backend hoặc kết nối mạng.";
      if (showMessage) showToast(error.message || "Không thể tải dữ liệu.");
    } finally {
      button.disabled = false;
    }
  }

  async function refreshLiveOnly() {
    try {
      await loadLive();
    } catch (error) {
      console.error(error);
      setConnection("offline", "Không kết nối được");
      $("poll-status").textContent = "Đang thử kết nối lại tự động.";
    }
  }

  // vẽ dải màu lên mặt các gauge (chạy 1 lần lúc khởi tạo)
  const ARC_R = 84;
  const bandPoint = (f) => [100 + ARC_R * Math.cos(Math.PI * (1 - f)), 100 - ARC_R * Math.sin(Math.PI * (1 - f))];
  for (const { key } of LIMITS) {
    const group = $(`gauge-${key}`)?.querySelector(".gauge-bands");
    if (!group) continue;
    let from = 0;
    for (const band of GAUGE_BANDS) {
      const to = band.to / 2; // thang mặt gauge = 2× ngưỡng
      const [x1, y1] = bandPoint(from + (from ? 0.004 : 0));
      const [x2, y2] = bandPoint(to - (to < 1 ? 0.004 : 0));
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1.toFixed(1)} ${y1.toFixed(1)} A${ARC_R} ${ARC_R} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      path.setAttribute("stroke", band.color);
      group.append(path);
      from = to;
    }
  }

  $("refresh-button").addEventListener("click", () => refreshAll(true));
  $("average-window").addEventListener("change", async (event) => {
    state.averageWindow = Number(event.target.value) === 8 ? 8 : 24;
    try {
      const result = await apiGet(`/api/readings/averages?window=${state.averageWindow}`);
      renderAverages(result.data);
    } catch (error) {
      showToast(error.message || "Không thể tải giá trị trung bình.");
    }
  });
  $("history-range").addEventListener("change", async (event) => {
    state.historyRange = event.target.value;
    try { await loadHistory(); }
    catch (error) { showToast(error.message || "Không thể tải lịch sử."); }
  });

  window.addEventListener("resize", () => {
    if (state.history.length) renderCharts(state.history);
  });

  refreshAll(false);
  setInterval(refreshLiveOnly, POLL_MS);
  setInterval(() => {
    if (Date.now() - state.historyLoadedAt >= HISTORY_MS) {
      loadHistory().catch((error) => console.error("History refresh failed:", error));
    }
  }, HISTORY_MS);
})();
