(() => {
  "use strict";

  const POLL_INTERVAL_MS = 10_000;
  const HISTORY_REFRESH_MS = 60_000;
  const HISTORY_LIMIT = 50_000;
  const $ = (id) => document.getElementById(id);

  const state = {
    history: [],
    averageWindow: 24,
    historyRange: "24h",
    historyLoadedAt: 0,
    toastTimer: null
  };

  const metrics = [
    { key: "pm1_0", id: "value-pm1_0", digits: 0 },
    { key: "pm2_5", id: "value-pm2_5", digits: 0 },
    { key: "pm10", id: "value-pm10", digits: 0 },
    { key: "co2", id: "value-co2", digits: 0 },
    { key: "temperature", id: "value-temperature", digits: 1 },
    { key: "humidity", id: "value-humidity", digits: 1 }
  ];

  const thresholds = {
    pm2_5: { value: 50, unit: "µg/m³" },
    pm10: { value: 100, unit: "µg/m³" },
    co2: { value: 1000, unit: "ppm" }
  };

  function numberFormat(value, digits = 1) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: digits }).format(Number(value));
  }

  function dateFormat(value, includeSeconds = true) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {})
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
    for (const metric of metrics) {
      $(metric.id).textContent = reading ? numberFormat(reading[metric.key], metric.digits) : "—";
    }
    if (!reading) {
      $("last-update").textContent = "Chưa có dữ liệu";
      $("sample-time").textContent = "Chưa nhận mẫu đo";
      return;
    }
    $("last-update").textContent = dateFormat(reading.received_at || reading.measured_at);
    $("sample-time").textContent = `Thời điểm đo: ${dateFormat(reading.measured_at)}`;
  }

  function renderAverages(summary) {
    const values = summary?.averages ?? {};
    for (const [key, rule] of Object.entries(thresholds)) {
      const value = values[key];
      const valueElement = $(`average-${key}`);
      const statusElement = $(`status-${key}`);
      valueElement.textContent = value === null || value === undefined ? "—" : `${numberFormat(value, 1)} ${rule.unit}`;
      statusElement.className = "status-pill";

      if (!summary?.complete || value === null || value === undefined) {
        statusElement.classList.add("status-pending");
        statusElement.textContent = "Đang tích lũy dữ liệu";
      } else if (Number(value) > rule.value) {
        statusElement.classList.add("status-bad");
        statusElement.textContent = "Vượt ngưỡng";
      } else {
        statusElement.classList.add("status-good");
        statusElement.textContent = "Trong ngưỡng";
      }
    }

    const windowLabel = state.averageWindow === 24 ? "24 giờ" : "8 giờ";
    $("average-footnote").textContent = summary?.complete
      ? `Cửa sổ ${windowLabel} đã đủ độ phủ dữ liệu · ${numberFormat(summary.sample_count, 0)} mẫu được ghi nhận.`
      : `Chưa đủ dữ liệu bao phủ trọn cửa sổ ${windowLabel}. Chưa thực hiện kết luận vượt ngưỡng.`;
  }

  function alertParameterLabel(parameter) {
    return ({ pm2_5: "PM2.5", pm10: "PM10", co2: "CO₂" })[parameter] || parameter;
  }

  function renderAlerts(alerts) {
    const alertList = Array.isArray(alerts) ? alerts : [];
    const activeCount = alertList.filter((item) => item.status === "active").length;
    $("active-alert-count").textContent = `${activeCount} đang hoạt động`;

    if (alertList.length === 0) {
      $("alerts-list").innerHTML = '<p class="empty-state">Chưa có sự kiện cảnh báo.</p>';
      return;
    }

    $("alerts-list").innerHTML = alertList.slice(0, 10).map((alert) => {
      const status = alert.status === "active" ? "active" : "resolved";
      const statusLabel = status === "active" ? "Đang hoạt động" : "Đã kết thúc";
      const unit = alert.parameter === "co2" ? "ppm" : "µg/m³";
      return `<article class="alert-item">
        <div class="alert-item-top">
          <span class="alert-title">${escapeHtml(alertParameterLabel(alert.parameter))} · cửa sổ ${escapeHtml(alert.window_hours)} giờ</span>
          <span class="alert-state ${status}">${statusLabel}</span>
        </div>
        <div class="alert-detail">Trung bình ${numberFormat(alert.average_value, 1)} ${unit} / ngưỡng ${numberFormat(alert.threshold_value, 0)} ${unit}</div>
        <div class="alert-time">${dateFormat(alert.created_at)}</div>
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

    // Downsample for drawing only; the table and database retain original samples.
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
    const duration = ({
      "1h": 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "5d": 5 * 24 * 60 * 60 * 1000
    })[range] || 24 * 60 * 60 * 1000;
    return new Date(Date.now() - duration);
  }

  async function loadLatestAndSummary() {
    const [latestResult, averageResult, alertResult] = await Promise.all([
      apiGet("/api/readings/latest"),
      apiGet(`/api/readings/averages?window=${state.averageWindow}`),
      apiGet("/api/alerts?limit=10")
    ]);
    renderLatest(latestResult.data);
    renderAverages(averageResult.data);
    renderAlerts(alertResult.data);

    if (latestResult.data?.received_at) {
      const ageSeconds = Math.max(0, (Date.now() - new Date(latestResult.data.received_at).getTime()) / 1000);
      if (ageSeconds > 45) {
        setConnection("offline", "Dữ liệu đang trễ");
        $("poll-status").textContent = `Mẫu cuối cách đây ${numberFormat(ageSeconds, 0)} giây`;
      } else {
        setConnection("online", "Đang hoạt động");
        $("poll-status").textContent = "Tự động cập nhật mỗi 10 giây";
      }
    } else {
      setConnection("online", "Máy chủ hoạt động");
      $("poll-status").textContent = "Backend sẵn sàng, đang chờ ESP32 gửi dữ liệu";
    }
  }

  async function loadHistory() {
    const from = getRangeStart(state.historyRange);
    const to = new Date();
    const query = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      limit: String(HISTORY_LIMIT)
    });
    const result = await apiGet(`/api/readings/history?${query.toString()}`);
    state.history = Array.isArray(result.data) ? result.data : [];
    state.historyLoadedAt = Date.now();
    renderHistoryTable(state.history);
    renderCharts(state.history);
    $("history-caption").textContent = `${dateFormat(from, false)} – ${dateFormat(to, false)} · Biểu đồ hiển thị tối đa 240 điểm đại diện.`;
  }

  async function refreshAll(showMessage = false) {
    const button = $("refresh-button");
    button.disabled = true;
    setConnection("loading", "Đang cập nhật");
    try {
      await Promise.all([loadLatestAndSummary(), loadHistory()]);
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
      await loadLatestAndSummary();
    } catch (error) {
      console.error(error);
      setConnection("offline", "Không kết nối được");
      $("poll-status").textContent = "Đang thử kết nối lại tự động.";
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
  setInterval(refreshLiveOnly, POLL_INTERVAL_MS);
  setInterval(() => {
    if (Date.now() - state.historyLoadedAt >= HISTORY_REFRESH_MS) {
      loadHistory().catch((error) => console.error("History refresh failed:", error));
    }
  }, HISTORY_REFRESH_MS);
})();
