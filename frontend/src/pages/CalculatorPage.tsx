import { useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { api } from "../api/client";
import type { Deal } from "../api/types";

function num(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number) {
  return `Rs ${value.toLocaleString()}`;
}

export default function CalculatorPage() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [buyPrice, setBuyPrice] = useState("10000000");
  const [rentMonthly, setRentMonthly] = useState("40000");
  const [annualCosts, setAnnualCosts] = useState("60000");
  const [sellPrice, setSellPrice] = useState("12000000");
  const [holdYears, setHoldYears] = useState("2");
  const [propertyType, setPropertyType] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [dealId, setDealId] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stateDealId = (location.state as { dealId?: string } | null)?.dealId || "";
    const nextDealId = searchParams.get("deal_id") || stateDealId;
    if (!nextDealId) return;
    let cancelled = false;
    setDealId(nextDealId);
    void (async () => {
      try {
        const deal = await api<Deal>(`/deals/${nextDealId}`);
        if (cancelled) return;
        if (deal.customer_budget != null) setBuyPrice(String(Math.round(deal.customer_budget)));
        else if (deal.ticket_size != null) setBuyPrice(String(Math.round(deal.ticket_size)));
        setPropertyType(deal.asset_type || deal.typology || "");
        setLocationLabel([deal.area, deal.city].filter(Boolean).join(", "));
        if (deal.expected_yield_pct != null) {
          const derivedAnnual = Math.round(((deal.expected_yield_pct / 100) * (deal.customer_budget || deal.ticket_size || 0)) / 12);
          if (derivedAnnual > 0) setRentMonthly(String(derivedAnnual));
        }
      } catch (e) {
        if (!cancelled) {
          setStatusMessage(e instanceof Error ? e.message : "Could not load deal context");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [location.state, searchParams]);

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
        {dealId ? <div className="pill">Connected to deal</div> : null}
      </div>
      {statusMessage ? <div className="alert ok">{statusMessage}</div> : null}

      <div className="calcGrid">
        <section className="card">
          <div className="cardTitle">Inputs</div>
          <div className="form">
            <div className="grid2">
              <label>
                Property Type
                <input value={propertyType} onChange={(e) => setPropertyType(e.target.value)} placeholder="Residential, commercial, plot..." />
              </label>
              <label>
                Location
                <input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="Area, city" />
              </label>
            </div>
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
          {dealId ? (
            <div className="row right">
              <button
                className="btn"
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setStatusMessage(null);
                  try {
                    await api<Deal>(`/deals/${dealId}`, {
                      method: "PATCH",
                      body: JSON.stringify({
                        expected_yield_pct: Number(out.yieldPct.toFixed(2)),
                        expected_roi_pct: Number(out.roiPct.toFixed(2)),
                        customer_budget: num(buyPrice),
                        typology: propertyType,
                        area: locationLabel,
                      }),
                    });
                    setStatusMessage("ROI values saved to deal");
                  } catch (e) {
                    setStatusMessage(e instanceof Error ? e.message : "Could not save ROI to deal");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving..." : "Save to Deal"}
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
