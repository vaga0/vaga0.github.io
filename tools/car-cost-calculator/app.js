/* =====================================================
   養車成本計算器 v2 — app.js
   ===================================================== */

'use strict';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
const state = {
    mainMode: 'ice',
    compareModes: new Set(),
};

let lineChartInstance = null;
let doughnutChartInstance = null;

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('zh-TW');
const fmtK = n => {
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + ' 百萬';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + ' 萬';
    return Math.round(n).toLocaleString();
};

function val(id, fallback = 0) {
    const el = $(id);
    if (!el) return fallback;
    const v = parseFloat(el.value);
    return isNaN(v) ? fallback : v;
}

// ─────────────────────────────────────────────
// Loan Calculator (等額本息)
// ─────────────────────────────────────────────
function calcMonthlyPayment(principal, annualRate, years) {
    if (years <= 0 || annualRate <= 0) return principal / Math.max(years * 12, 1);
    const r = annualRate / 100 / 12;
    const n = years * 12;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
}

// ─────────────────────────────────────────────
// ICE Cost Model
// ─────────────────────────────────────────────
function calcICE(years) {
    const carPrice = val('carPrice');
    const downPayment = val('downPayment');
    const loanRate = val('loanRate');
    const loanYears = val('loanYears');
    const fuelMonthly = val('fuelMonthly');
    const parkingMonthly = val('parkingMonthly');
    const etcMonthly = val('etcMonthly');
    const fineYearly = val('fineYearly');
    const maintenanceCost = val('maintenanceCost');
    const maintenanceInterval = val('maintenanceInterval');
    const tireCost = val('tireCost');
    const tireInterval = val('tireInterval');
    const insuranceMandatory = val('insuranceMandatory');
    const insuranceOptional = val('insuranceOptional');
    const licenseTax = val('licenseTax');
    const fuelTax = val('fuelTax');
    const inspectionFee = val('inspectionFee');
    const depreciationRate = val('depreciationRate') / 100;
    const investRate = val('investReturnRate') / 100;
    const inflation = val('inflationRate') / 100;
    const annualKm = val('annualKm');

    const loanPrincipal = carPrice - downPayment;
    const monthlyPayment = calcMonthlyPayment(loanPrincipal, loanRate, loanYears);

    const customItems = getCustomItems();

    let rows = [];
    let cumulativeCost = downPayment; // 頭期款算入第1年
    let residualValue = carPrice;
    // 計算若把頭期款拿去投資（每年再加省下的分期款）
    let investValue = downPayment;

    for (let y = 1; y <= years; y++) {
        // 貸款
        const loanAnnual = y <= loanYears ? monthlyPayment * 12 : 0;

        // 使用
        const inf = Math.pow(1 + inflation, y - 1);
        const usageAnnual = (fuelMonthly + parkingMonthly + etcMonthly) * 12 * inf + fineYearly * inf;

        // 保養
        const maintenancePerYear = (12 / maintenanceInterval) * maintenanceCost * inf;
        const tirePerYear = (y % tireInterval === 0) ? tireCost * inf : 0;
        const maintenanceAnnual = maintenancePerYear + tirePerYear;

        // 保險稅費
        const inspections = y >= 10 ? 2 : (y >= 5 ? 1 : 0);
        const taxAnnual = (insuranceMandatory + insuranceOptional + licenseTax + fuelTax + inspectionFee * inspections) * inf;

        // 自訂費用
        let customAnnual = 0;
        customItems.forEach(item => {
            if (y >= item.startYear && (y - item.startYear) % item.interval === 0) {
                customAnnual += item.cost * inf;
            }
        });

        const yearTotal = loanAnnual + usageAnnual + maintenanceAnnual + taxAnnual + customAnnual;
        cumulativeCost += yearTotal;

        // 殘值
        residualValue *= (1 - depreciationRate);
        const netCost = cumulativeCost - residualValue;

        // 投資機會成本（頭期款 + 每月省下的錢複利成長）
        investValue = investValue * (1 + investRate) + yearTotal * (1 + investRate / 2); // 年中平均投入
        const avgYearCost = cumulativeCost / y;

        rows.push({
            year: y,
            loan: loanAnnual,
            usage: usageAnnual,
            maintenance: maintenanceAnnual,
            tax: taxAnnual,
            custom: customAnnual,
            yearTotal,
            cumulative: cumulativeCost,
            monthly: cumulativeCost / (y * 12),
            residualValue,
            netCost,
            avgYearCost,
            investValue,
        });
    }

    // 成本結構（用於圓餅圖）
    const totalFuel = (fuelMonthly * 12 * years);
    const totalParking = (parkingMonthly * 12 * years);
    const totalEtc = (etcMonthly * 12 * years);
    const totalFine = fineYearly * years;
    const totalMaintenance = rows.reduce((s, r) => s + r.maintenance, 0);
    const totalTax = rows.reduce((s, r) => s + r.tax, 0);
    const totalLoan = rows.reduce((s, r) => s + r.loan, 0) + downPayment;
    const totalCustom = rows.reduce((s, r) => s + r.custom, 0);

    const breakdown = { 購車成本: totalLoan, 油費: totalFuel, 停車與ETC: totalParking + totalEtc, 保養: totalMaintenance, 保險稅費: totalTax, 罰單: totalFine, 自訂: totalCustom };

    // 甜蜜點
    const sweetRow = rows.reduce((min, r) => r.avgYearCost < min.avgYearCost ? r : min);

    return { rows, breakdown, sweetRow, annualKm, label: '燃油車', color: '#FF9F43' };
}

// ─────────────────────────────────────────────
// EV Cost Model
// ─────────────────────────────────────────────
function calcEV(years) {
    const carPrice = val('evCarPrice');
    const downPayment = val('evDownPayment');
    const loanRate = val('evLoanRate');
    const loanYears = val('evLoanYears');
    const batteryKwh = val('evBatteryKwh');
    const efficiency = val('evEfficiency'); // km/kWh
    const homeRate = val('evHomeRate');
    const fastRate = val('evFastRate');
    const homePercent = val('evHomeChargePercent') / 100;
    const chargerInstall = val('evChargerInstall');
    const parkingMonthly = val('evParkingMonthly');
    const etcMonthly = val('evEtcMonthly');
    const fineYearly = val('evFineYearly');
    const maintenanceCostYear = val('evMaintenanceCost');
    const tireCost = val('evTireCost');
    const tireInterval = val('evTireInterval');
    const insuranceMandatory = val('evInsuranceMandatory');
    const insuranceOptional = val('evInsuranceOptional');
    const licenseTax = val('evLicenseTax');
    const inspectionFee = val('evInspectionFee');
    const batteryWarrantyYears = val('evBatteryWarrantyYears');
    const batteryReplaceCost = val('evBatteryReplaceCost');
    const depreciationRate = val('evDepreciationRate') / 100;
    const investRate = val('investReturnRate') / 100;
    const inflation = val('inflationRate') / 100;
    const annualKm = val('annualKm');

    const loanPrincipal = carPrice - downPayment;
    const monthlyPayment = calcMonthlyPayment(loanPrincipal, loanRate, loanYears);

    const customItems = getCustomItems();

    // 充電費計算（每年）
    function evChargeAnnual(annualKm, inflation, year) {
        const inf = Math.pow(1 + inflation, year - 1);
        const totalKwh = annualKm / efficiency;
        const homeKwh = totalKwh * homePercent;
        const fastKwh = totalKwh * (1 - homePercent);
        return (homeKwh * homeRate + fastKwh * fastRate) * inf;
    }

    let rows = [];
    let cumulativeCost = downPayment + chargerInstall;
    let residualValue = carPrice;
    let investValue = downPayment + chargerInstall;

    for (let y = 1; y <= years; y++) {
        const loanAnnual = y <= loanYears ? monthlyPayment * 12 : 0;
        const inf = Math.pow(1 + inflation, y - 1);

        // 充電費
        const chargeAnnual = evChargeAnnual(annualKm, inflation, y);
        const parkAnnual = (parkingMonthly * 12 + etcMonthly * 12 + fineYearly) * inf;
        const usageAnnual = chargeAnnual + parkAnnual;

        // 保養（EV 保養費直接給年度金額）
        const tirePerYear = (y % tireInterval === 0) ? tireCost * inf : 0;
        const maintenanceAnnual = maintenanceCostYear * inf + tirePerYear;

        // 電池更換準備金（只在保固屆滿的那一年計入）
        const batteryExtra = (y === batteryWarrantyYears + 1 && batteryReplaceCost > 0) ? batteryReplaceCost : 0;

        const inspections = y >= 10 ? 2 : (y >= 5 ? 1 : 0);
        const taxAnnual = (insuranceMandatory + insuranceOptional + licenseTax + inspectionFee * inspections) * inf;

        let customAnnual = 0;
        customItems.forEach(item => {
            if (y >= item.startYear && (y - item.startYear) % item.interval === 0) {
                customAnnual += item.cost * inf;
            }
        });

        const yearTotal = loanAnnual + usageAnnual + maintenanceAnnual + taxAnnual + customAnnual + batteryExtra;
        cumulativeCost += yearTotal;

        residualValue *= (1 - depreciationRate);
        // 電池過保後殘值額外折損
        if (y === batteryWarrantyYears + 1) {
            residualValue *= 0.75;
        }
        const netCost = cumulativeCost - residualValue;

        investValue = investValue * (1 + investRate) + yearTotal * (1 + investRate / 2);
        const avgYearCost = cumulativeCost / y;

        rows.push({
            year: y,
            loan: loanAnnual,
            usage: usageAnnual,
            maintenance: maintenanceAnnual,
            tax: taxAnnual + batteryExtra,
            custom: customAnnual,
            yearTotal,
            cumulative: cumulativeCost,
            monthly: cumulativeCost / (y * 12),
            residualValue,
            netCost,
            avgYearCost,
            investValue,
        });
    }

    const breakdown = {
        購車成本: rows.reduce((s, r) => s + r.loan, 0) + downPayment + chargerInstall,
        充電費: rows.reduce((s, r) => s + r.usage, 0) * (annualKm / efficiency * homePercent * homeRate) / (annualKm / efficiency * (homePercent * homeRate + (1 - homePercent) * fastRate)) || rows.reduce((s, r) => s + r.usage * 0.5, 0),
        停車費用: val('evParkingMonthly') * 12 * years,
        保養: rows.reduce((s, r) => s + r.maintenance, 0),
        保險稅費: rows.reduce((s, r) => s + r.tax, 0),
        自訂: rows.reduce((s, r) => s + r.custom, 0),
    };

    const sweetRow = rows.reduce((min, r) => r.avgYearCost < min.avgYearCost ? r : min);

    return { rows, breakdown, sweetRow, annualKm, label: '純電車', color: '#48CFAD' };
}

// ─────────────────────────────────────────────
// Rental Cost Model
// ─────────────────────────────────────────────
function calcRental(years) {
    const monthlyRent = val('rentalMonthly');
    const deposit = val('rentalDeposit');
    const kmLimit = val('rentalKmLimit');
    const overKmFee = val('rentalOverKmFee');
    const fuelMonthly = val('rentalFuelMonthly');
    const parkingMonthly = val('rentalParkingMonthly');
    const etcMonthly = val('rentalEtcMonthly');
    const investRate = val('investReturnRate') / 100;
    const inflation = val('inflationRate') / 100;
    const annualKm = val('annualKm');

    const overKmAnnual = Math.max(0, annualKm - kmLimit) * overKmFee;

    let rows = [];
    let cumulativeCost = deposit;
    let investValue = deposit; // 押金的資金機會成本

    for (let y = 1; y <= years; y++) {
        const inf = Math.pow(1 + inflation, y - 1);
        const rentAnnual = monthlyRent * 12 * inf;
        const usageAnnual = (fuelMonthly + parkingMonthly + etcMonthly) * 12 * inf + overKmAnnual * inf;
        const yearTotal = rentAnnual + usageAnnual;
        cumulativeCost += yearTotal;
        investValue = investValue * (1 + investRate) + yearTotal * (1 + investRate / 2);
        const avgYearCost = cumulativeCost / y;

        rows.push({ year: y, loan: rentAnnual, usage: usageAnnual, maintenance: 0, tax: 0, custom: 0, yearTotal, cumulative: cumulativeCost, monthly: cumulativeCost / (y * 12), residualValue: 0, netCost: cumulativeCost, avgYearCost, investValue });
    }

    return { rows, breakdown: { 長期租金: rows.reduce((s, r) => s + r.loan, 0), 油費停車: rows.reduce((s, r) => s + r.usage, 0) }, sweetRow: null, annualKm, label: '長期租車', color: '#58A6FF' };
}

// ─────────────────────────────────────────────
// Subscription Cost Model
// ─────────────────────────────────────────────
function calcSubscription(years) {
    const monthlyBase = val('subMonthlyBase');
    const perKm = val('subPerKm');
    const initFee = val('subInitFee');
    const parkingMonthly = val('subParkingMonthly');
    const etcMonthly = val('subEtcMonthly');
    const investRate = val('investReturnRate') / 100;
    const inflation = val('inflationRate') / 100;
    const annualKm = val('annualKm');

    let rows = [];
    let cumulativeCost = initFee;
    let investValue = initFee;

    for (let y = 1; y <= years; y++) {
        const inf = Math.pow(1 + inflation, y - 1);
        const subAnnual = monthlyBase * 12 * inf;
        const kmAnnual = perKm * annualKm * inf;
        const parkAnnual = (parkingMonthly + etcMonthly) * 12 * inf;
        const yearTotal = subAnnual + kmAnnual + parkAnnual;
        cumulativeCost += yearTotal;
        investValue = investValue * (1 + investRate) + yearTotal * (1 + investRate / 2);
        const avgYearCost = cumulativeCost / y;

        rows.push({ year: y, loan: subAnnual + kmAnnual, usage: parkAnnual, maintenance: 0, tax: 0, custom: 0, yearTotal, cumulative: cumulativeCost, monthly: cumulativeCost / (y * 12), residualValue: 0, netCost: cumulativeCost, avgYearCost, investValue });
    }

    return { rows, breakdown: { 訂閱月費: rows.reduce((s, r) => s + r.loan, 0), 停車費用: rows.reduce((s, r) => s + r.usage, 0) }, sweetRow: null, annualKm, label: '訂閱制', color: '#C77DFF' };
}

// ─────────────────────────────────────────────
// Uber / Ride-hailing Cost Model
// ─────────────────────────────────────────────
function calcUber(years) {
    const commuteTrips = val('uberCommuteTrips');
    const commutePrice = val('uberCommutePrice');
    const weekendTrips = val('uberWeekendTrips');
    const weekendPrice = val('uberWeekendPrice');
    const transitMonthly = val('uberTransitMonthly');
    const investRate = val('investReturnRate') / 100;
    const inflation = val('inflationRate') / 100;

    const monthlyTotal = commuteTrips * commutePrice + weekendTrips * weekendPrice + transitMonthly;

    let rows = [];
    let cumulativeCost = 0;
    let investValue = 0;

    for (let y = 1; y <= years; y++) {
        const inf = Math.pow(1 + inflation, y - 1);
        const yearTotal = monthlyTotal * 12 * inf;
        cumulativeCost += yearTotal;
        investValue = investValue * (1 + investRate) + yearTotal * (1 + investRate / 2);
        const avgYearCost = cumulativeCost / y;

        rows.push({ year: y, loan: commuteTrips * commutePrice * 12 * inf, usage: (weekendTrips * weekendPrice + transitMonthly) * 12 * inf, maintenance: 0, tax: 0, custom: 0, yearTotal, cumulative: cumulativeCost, monthly: cumulativeCost / (y * 12), residualValue: 0, netCost: cumulativeCost, avgYearCost, investValue });
    }

    return { rows, breakdown: { 通勤叫車: rows.reduce((s, r) => s + r.loan, 0), 假日與大眾運輸: rows.reduce((s, r) => s + r.usage, 0) }, sweetRow: null, annualKm: 0, label: '叫車為主', color: '#FFD166' };
}

// ─────────────────────────────────────────────
// Custom Items
// ─────────────────────────────────────────────
function getCustomItems() {
    const items = [];
    document.querySelectorAll('.custom-item').forEach(el => {
        const cost = parseFloat(el.querySelector('.ci-cost')?.value) || 0;
        const interval = parseInt(el.querySelector('.ci-interval')?.value) || 1;
        const startYear = parseInt(el.querySelector('.ci-start')?.value) || 1;
        if (cost > 0) items.push({ cost, interval, startYear });
    });
    return items;
}

function addCustomItem() {
    const container = $('customItems');
    const div = document.createElement('div');
    div.className = 'custom-item';
    div.innerHTML = `
    <div class="field"><label>費用名稱</label><input type="text" class="ci-name" placeholder="例：大修" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-primary);font-size:13px;width:100%"></div>
    <div class="field"><label>金額（元）</label><input type="number" class="ci-cost" value="20000" min="0" step="1000" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-primary);font-size:13px;width:100%"></div>
    <div class="field"><label>每幾年1次</label><input type="number" class="ci-interval" value="5" min="1" max="30" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-primary);font-size:13px;width:100%"></div>
    <div class="field"><label>起始年份</label><input type="number" class="ci-start" value="1" min="1" max="30" style="padding:8px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text-primary);font-size:13px;width:100%"></div>
    <button type="button" class="remove-btn">✕</button>
  `;
    div.querySelector('.remove-btn').addEventListener('click', () => div.remove());
    container.appendChild(div);
}

// ─────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────
function goToStep(n) {
    document.querySelectorAll('.step-section').forEach((s, i) => {
        s.classList.toggle('active', i + 1 === n);
    });
    document.querySelectorAll('.step-item').forEach((item, i) => {
        item.classList.remove('active', 'done');
        if (i + 1 < n) item.classList.add('done');
        if (i + 1 === n) item.classList.add('active');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function applyModeToStep2() {
    const mode = state.mainMode;
    $('block-ice').style.display = mode === 'ice' ? '' : 'none';
    $('block-ev').style.display = mode === 'ev' ? '' : 'none';

    $('block-rental').style.display = state.compareModes.has('rental') ? '' : 'none';
    $('block-subscription').style.display = state.compareModes.has('subscription') ? '' : 'none';
    $('block-uber').style.display = state.compareModes.has('uber') ? '' : 'none';
}

// ─────────────────────────────────────────────
// Render Results
// ─────────────────────────────────────────────
function calculate(e) {
    e?.preventDefault();
    const years = Math.min(Math.max(val('holdingYears', 30), 1), 30);

    // 計算各方案
    const mainResult = state.mainMode === 'ev' ? calcEV(years) : calcICE(years);
    const compareResults = [];
    if (state.compareModes.has('rental')) compareResults.push(calcRental(years));
    if (state.compareModes.has('subscription')) compareResults.push(calcSubscription(years));
    if (state.compareModes.has('uber')) compareResults.push(calcUber(years));

    const allResults = [mainResult, ...compareResults];

    // 決策建議
    renderDecision(mainResult, compareResults);

    // 方案摘要卡
    renderCompareCards(allResults);

    // 折線圖
    renderLineChart(allResults, years);

    // 圓餅圖
    renderDoughnut(mainResult);

    // 每公里 TCO
    renderPerKm(mainResult, years);

    // 明細表
    renderTable(mainResult, years);

    goToStep(3);
}

// ─────────────────────────────────────────────
// Decision Banner
// ─────────────────────────────────────────────
function renderDecision(main, compares) {
    const years = Math.min(Math.max(val('holdingYears', 30), 1), 30);
    const mainMonthly = main.rows[years - 1]?.monthly || 0;
    let text = `<strong>${main.label}</strong> ${years} 年總持有成本 <strong>${fmtK(main.rows[years - 1]?.cumulative || 0)} 元</strong>，平均每月需 <strong>${fmt(mainMonthly)} 元</strong>。`;

    if (compares.length > 0) {
        const cheaper = compares.filter(c => c.rows[years - 1]?.cumulative < main.rows[years - 1]?.cumulative);
        const pricier = compares.filter(c => c.rows[years - 1]?.cumulative >= main.rows[years - 1]?.cumulative);

        if (cheaper.length > 0) {
            const bestAlt = cheaper.reduce((a, b) => a.rows[years - 1]?.cumulative < b.rows[years - 1]?.cumulative ? a : b);
            const diff = main.rows[years - 1]?.cumulative - bestAlt.rows[years - 1]?.cumulative;
            text += `<br><br>✅ 若改採 <strong>${bestAlt.label}</strong>，${years} 年可少花 <strong>${fmtK(diff)} 元</strong>。`;
        }
        if (pricier.length > 0) {
            text += `<br>⚠️ ${pricier.map(c => `<strong>${c.label}</strong>`).join('、')} 的總花費高於${main.label}，不建議為了省錢而選。`;
        }
    } else {
        if (main.sweetRow) {
            text += `<br><br>🎯 持有 <strong>${main.sweetRow.year} 年</strong> 時年均成本最低（${fmt(main.sweetRow.avgYearCost)} 元/年），是換車的黃金甜蜜點。`;
        }
    }

    $('decisionBanner').querySelector('.decision-text').innerHTML = text;
}

// ─────────────────────────────────────────────
// Compare Cards
// ─────────────────────────────────────────────
function renderCompareCards(results) {
    const years = Math.min(Math.max(val('holdingYears', 30), 1), 30);
    const container = $('compareCards');
    container.innerHTML = '';

    const minCost = Math.min(...results.map(r => r.rows[years - 1]?.cumulative || Infinity));

    results.forEach((result, idx) => {
        const row = result.rows[years - 1];
        if (!row) return;
        const isBest = row.cumulative === minCost;
        const isMain = idx === 0;

        const card = document.createElement('div');
        card.className = 'result-card';
        card.style.setProperty('--card-color', result.color);

        const tags = [];
        if (result.sweetRow) tags.push(`🎯 甜蜜點：第 ${result.sweetRow.year} 年`);
        if (result.annualKm) tags.push(`📍 ${result.label.includes('電') ? '每 km 電費' : '年均里程'}`);
        if (!result.sweetRow && !isMain) tags.push('📋 零殘值風險');

        card.innerHTML = `
      ${isBest ? '<div class="best-badge">最划算</div>' : ''}
      <div class="rc-badge">${isMain ? '✦ 主方案' : '對比'} ${result.label}</div>
      <div class="rc-label">${years} 年總花費</div>
      <div class="rc-value">${fmtK(row.cumulative)} 元</div>
      <div class="rc-sub">vs 投資機會成本 ${fmtK(row.investValue)} 元</div>
      <div class="rc-monthly">
        <div class="rc-label">月均成本</div>
        <div style="font-size:1.1rem;font-weight:700;color:${result.color}">${fmt(row.monthly)} 元</div>
      </div>
      <div class="rc-tags">
        ${tags.map(t => `<div class="rc-tag">${t}</div>`).join('')}
      </div>
    `;
        container.appendChild(card);
    });
}

// ─────────────────────────────────────────────
// Line Chart
// ─────────────────────────────────────────────
function renderLineChart(results, years) {
    const ctx = $('lineChart').getContext('2d');
    if (lineChartInstance) lineChartInstance.destroy();

    const labels = Array.from({ length: years }, (_, i) => `第${i + 1}年`);
    const datasets = results.map(r => ({
        label: r.label,
        data: r.rows.map(row => row.cumulative),
        borderColor: r.color,
        backgroundColor: r.color + '18',
        borderWidth: 2.5,
        pointRadius: 0,
        tension: 0.4,
        fill: false,
    }));

    // 加入投資線
    datasets.push({
        label: '若全拿去投資',
        data: results[0].rows.map(r => r.investValue),
        borderColor: '#ffffff30',
        borderWidth: 1.5,
        borderDash: [6, 4],
        pointRadius: 0,
        tension: 0.4,
        fill: false,
    });

    lineChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text-secondary'), font: { size: 11 }, boxWidth: 24, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}：${fmt(ctx.parsed.y)} 元`,
                    },
                },
            },
            scales: {
                x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted'), font: { size: 10 }, maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.04)' } },
                y: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--text-muted'), font: { size: 10 }, callback: v => fmtK(v) }, grid: { color: 'rgba(255,255,255,0.04)' } },
            },
        },
    });
}

// ─────────────────────────────────────────────
// Doughnut Chart
// ─────────────────────────────────────────────
function renderDoughnut(result) {
    const ctx = $('doughnutChart').getContext('2d');
    if (doughnutChartInstance) doughnutChartInstance.destroy();

    const entries = Object.entries(result.breakdown).filter(([, v]) => v > 0);
    const palette = ['#6C63FF', '#48CFAD', '#FF6B6B', '#FFD166', '#58A6FF', '#C77DFF', '#FF9F43'];

    doughnutChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: entries.map(([k]) => k),
            datasets: [{ data: entries.map(([, v]) => Math.round(v)), backgroundColor: palette, borderWidth: 2, borderColor: 'var(--bg-card)' }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { position: 'bottom', labels: { color: getComputedStyle(document.body).getPropertyValue('--text-secondary'), font: { size: 11 }, padding: 12, boxWidth: 12 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.label}：${fmtK(ctx.parsed)} 元` } },
            },
        },
    });
}

// ─────────────────────────────────────────────
// Per KM
// ─────────────────────────────────────────────
function renderPerKm(main, years) {
    const row = main.rows[years - 1];
    if (!row || !main.annualKm) {
        $('perKmBar').style.display = 'none';
        return;
    }
    $('perKmBar').style.display = 'flex';
    const totalKm = main.annualKm * years;
    const perKm = row.cumulative / totalKm;
    $('perKmCost').textContent = perKm.toFixed(1) + ' 元/km';
    $('perKmHint').textContent = `基於 ${years} 年、每年 ${(main.annualKm / 1000).toFixed(0)} 千公里（共 ${fmtK(totalKm)} 公里）`;
}

// ─────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────
function renderTable(main, years) {
    $('detailTableTitle').textContent = `📋 ${main.label}逐年成本明細`;
    const tbody = $('detailBody');
    tbody.innerHTML = '';

    const isPurchase = !['長期租車', '訂閱制', '叫車為主'].includes(main.label);
    const header = document.querySelector('#detailTable thead tr');
    header.children[1].textContent = isPurchase ? '貸款' : '租金/月費';
    header.children[9].textContent = isPurchase ? '殘值' : '—';
    header.children[10].textContent = isPurchase ? '持有淨成本' : '累計';

    main.rows.forEach(r => {
        const tr = document.createElement('tr');
        if (main.sweetRow && r.year === main.sweetRow.year) tr.className = 'sweet-spot';
        tr.innerHTML = `
      <td>${r.year}</td>
      <td>${fmt(r.loan)}</td>
      <td>${fmt(r.usage)}</td>
      <td>${fmt(r.maintenance)}</td>
      <td>${fmt(r.tax)}</td>
      <td>${r.custom > 0 ? fmt(r.custom) : '—'}</td>
      <td><strong>${fmt(r.yearTotal)}</strong></td>
      <td>${fmt(r.cumulative)}</td>
      <td>${fmt(r.monthly)}</td>
      <td>${isPurchase ? fmt(r.residualValue) : '—'}</td>
      <td>${fmt(r.netCost)}</td>
      <td>${fmt(r.avgYearCost)}</td>
      <td>${fmt(r.investValue)}</td>
    `;
        tbody.appendChild(tr);
    });
}

// ─────────────────────────────────────────────
// localStorage
// ─────────────────────────────────────────────
function saveForm() {
    const data = {};
    document.querySelectorAll('#calcForm input[id]').forEach(el => {
        data[el.id] = el.value;
    });
    data._mainMode = state.mainMode;
    data._compareModes = [...state.compareModes];
    localStorage.setItem('ccc_v2', JSON.stringify(data));
}

function loadForm() {
    try {
        const data = JSON.parse(localStorage.getItem('ccc_v2') || '{}');
        Object.entries(data).forEach(([k, v]) => {
            if (k.startsWith('_')) return;
            const el = $(k);
            if (el) el.value = v;
        });
        if (data._mainMode) {
            state.mainMode = data._mainMode;
            const radio = document.querySelector(`input[name="mainMode"][value="${data._mainMode}"]`);
            if (radio) radio.checked = true;
        }
        if (Array.isArray(data._compareModes)) {
            data._compareModes.forEach(m => {
                state.compareModes.add(m);
                const cb = document.querySelector(`input[name="compareMode"][value="${m}"]`);
                if (cb) cb.checked = true;
            });
        }
    } catch (e) { /* ignore */ }
}

function resetForm() {
    localStorage.removeItem('ccc_v2');
    location.reload();
}

// ─────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────
function initTheme() {
    const saved = localStorage.getItem('ccc_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeBtn(saved);
}

function updateThemeBtn(theme) {
    const btn = $('themeToggle');
    if (theme === 'dark') {
        btn.querySelector('.toggle-emoji').textContent = '☀️';
        btn.querySelector('.toggle-label').textContent = '淺色模式';
    } else {
        btn.querySelector('.toggle-emoji').textContent = '🌙';
        btn.querySelector('.toggle-label').textContent = '深色模式';
    }
}

function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ccc_theme', next);
    updateThemeBtn(next);
}

// ─────────────────────────────────────────────
// Card Collapse
// ─────────────────────────────────────────────
function initCardToggles() {
    document.querySelectorAll('.card-header[data-toggle]').forEach(header => {
        header.addEventListener('click', () => {
            const id = header.dataset.toggle;
            const body = $(`body-${id}`);
            if (!body) return;
            const isOpen = body.classList.contains('open');
            body.classList.toggle('open', !isOpen);
            body.style.display = isOpen ? 'none' : 'block';
            const card = header.closest('.card');
            card?.classList.toggle('collapsed', isOpen);
        });
    });
}

// ─────────────────────────────────────────────
// Uber live preview
// ─────────────────────────────────────────────
function updateUberPreview() {
    const monthly = val('uberCommuteTrips') * val('uberCommutePrice')
        + val('uberWeekendTrips') * val('uberWeekendPrice')
        + val('uberTransitMonthly');
    const el = $('uberMonthlyTotal');
    if (el) el.textContent = fmt(monthly) + ' 元';
}

// ─────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadForm();
    initCardToggles();
    applyModeToStep2();

    // Step 1 → Step 2
    $('toStep2Btn').addEventListener('click', () => {
        applyModeToStep2();
        saveForm();
        goToStep(2);
    });

    // Step 2 back
    $('backToStep1Btn').addEventListener('click', () => goToStep(1));

    // Step 3 back
    $('backToStep2Btn').addEventListener('click', () => goToStep(2));
    $('backToStep1Btn2').addEventListener('click', () => goToStep(1));

    // Main mode switch
    document.querySelectorAll('input[name="mainMode"]').forEach(radio => {
        radio.addEventListener('change', () => { state.mainMode = radio.value; });
    });

    // Compare mode
    document.querySelectorAll('input[name="compareMode"]').forEach(cb => {
        cb.addEventListener('change', () => {
            if (cb.checked) state.compareModes.add(cb.value);
            else state.compareModes.delete(cb.value);
        });
    });

    // Form submit
    $('calcForm').addEventListener('submit', calculate);

    // Reset
    $('resetBtn').addEventListener('click', resetForm);

    // Add custom item
    $('addCustomItem').addEventListener('click', addCustomItem);

    // Theme
    $('themeToggle').addEventListener('click', toggleTheme);

    // Uber live preview
    ['uberCommuteTrips', 'uberCommutePrice', 'uberWeekendTrips', 'uberWeekendPrice', 'uberTransitMonthly'].forEach(id => {
        const el = $(id);
        if (el) el.addEventListener('input', updateUberPreview);
    });
    updateUberPreview();
});
