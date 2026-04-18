import { useMemo, useState } from "react";

function num(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number) {
  return `Rs ${value.toLocaleString()}`;
}

export default function CalculatorPage() {
  const [buyPrice, setBuyPrice] = useState("10000000");
  const [rentMonthly, setRentMonthly] = useState("40000");
  const [annualCosts, setAnnualCosts] = useState("60000");
  const [sellPrice, setSellPrice] = useState("12000000");
  const [holdYears, setHoldYears] = useState("2");

  const out = useMemo(() => {
    const buy = num(buyPrice);
    const rent = num(rentMonthly);
    const costs = num(annualCosts);
    const sell = num(sellPrice);
    const years = Math.max(1, Math.floor(num(holdYears)));

    const annualRent = rent * 12;
    const netAnnual = annualRent - costs;
    const yieldPct = buy > 0 ? (netAnnual / buy) * 100 : 0;

    const totalNetRent = netAnnual * years;
    const flipProfit = sell - buy;
    const totalProfit = totalNetRent + flipProfit;
    const roiPct = buy > 0 ? (totalProfit / buy) * 100 : 0;

    return { annualRent, netAnnual, yieldPct, totalNetRent, flipProfit, totalProfit, roiPct, years };
  }, [annualCosts, buyPrice, holdYears, rentMonthly, sellPrice]);

  return (
    <div className="page">
      <div className="pageHeader">
        <div>
          <div className="h1">ROI Calculator</div>
          <div className="muted">Estimate rental yield, hold profit, and resale upside before you push a deal forward.</div>
        </div>
      </div>

      <div className="calcGrid">
        <section className="card">
          <div className="cardTitle">Inputs</div>
          <div className="form">
            <label>
              Buy Price (Rs)
              <input inputMode="numeric" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
            </label>
            <label>
              Monthly Rent (Rs)
              <input inputMode="numeric" value={rentMonthly} onChange={(e) => setRentMonthly(e.target.value)} />
            </label>
            <label>
              Annual Costs (Rs)
              <input inputMode="numeric" value={annualCosts} onChange={(e) => setAnnualCosts(e.target.value)} />
            </label>
            <label>
              Sell Price (Rs)
              <input inputMode="numeric" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
            </label>
            <label>
              Hold Period (years)
              <input inputMode="numeric" value={holdYears} onChange={(e) => setHoldYears(e.target.value)} />
            </label>
          </div>
        </section>

        <section className="card premiumPanel">
          <div className="cardTitle">Results</div>
          <div className="kv">
            <div className="k">Annual Rent</div>
            <div className="v">{formatMoney(out.annualRent)}</div>
            <div className="k">Net Annual Income</div>
            <div className="v">{formatMoney(out.netAnnual)}</div>
            <div className="k">Rental Yield</div>
            <div className="v">{out.yieldPct.toFixed(2)}%</div>
            <div className="k">Hold Period</div>
            <div className="v">{out.years} year(s)</div>
            <div className="k">Total Net Rent</div>
            <div className="v">{formatMoney(out.totalNetRent)}</div>
            <div className="k">Resale Profit</div>
            <div className="v">{formatMoney(out.flipProfit)}</div>
            <div className="k">Total Profit</div>
            <div className="v">{formatMoney(out.totalProfit)}</div>
            <div className="k">ROI</div>
            <div className="v">{out.roiPct.toFixed(2)}%</div>
          </div>
        </section>
      </div>
    </div>
  );
}
