/**
 * Pure forecast engine for the Deals pipeline.
 *
 * Takes a snapshot of `Deal` rows + recent loss reasons and returns the
 * weighted/unweighted pipeline value, per-stage breakdown, conversion rate,
 * average sales cycle, top open deals, and loss-reason histogram.
 *
 * No DB calls, no LLM calls. The service layer hands this function the data
 * it needs and returns the result over the wire to the dashboard / AI tool.
 */
import type { Deal, DealLossReason, DealSource, DealStage } from '@wacrm/database';

export interface DealForecastSnapshot {
  rangeDays: number;
  /** All deals (open + closed) created within the range. */
  deals: Pick<
    Deal,
    | 'id'
    | 'title'
    | 'stage'
    | 'source'
    | 'value'
    | 'probability'
    | 'wonAt'
    | 'lostAt'
    | 'lostReasonCode'
    | 'salesCycleDays'
    | 'createdAt'
  >[];
}

export interface DealForecast {
  rangeDays: number;
  totalDeals: number;
  openDeals: number;
  pipelineValueRaw: number;
  pipelineValueWeighted: number;
  wonValue: number;
  wonCount: number;
  lostValue: number;
  lostCount: number;
  conversionRate: number;          // 0-100
  avgSalesCycleDays: number;       // mean of WON deals only
  byStage: Record<DealStage, { count: number; value: number; weighted: number }>;
  bySource: Record<string, { count: number; value: number }>;
  topOpenDeals: Array<{ id: string; title: string; value: number; weighted: number; probability: number; stage: DealStage }>;
  lossReasons: Record<string, number>;
}

const STAGE_KEYS: DealStage[] = ['LEAD_IN', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'];

function emptyByStage(): DealForecast['byStage'] {
  const out = {} as DealForecast['byStage'];
  for (const s of STAGE_KEYS) out[s] = { count: 0, value: 0, weighted: 0 };
  return out;
}

export function computeForecast(snapshot: DealForecastSnapshot): DealForecast {
  const out: DealForecast = {
    rangeDays: snapshot.rangeDays,
    totalDeals: snapshot.deals.length,
    openDeals: 0,
    pipelineValueRaw: 0,
    pipelineValueWeighted: 0,
    wonValue: 0,
    wonCount: 0,
    lostValue: 0,
    lostCount: 0,
    conversionRate: 0,
    avgSalesCycleDays: 0,
    byStage: emptyByStage(),
    bySource: {},
    topOpenDeals: [],
    lossReasons: {},
  };

  const wonCycleDays: number[] = [];

  for (const d of snapshot.deals) {
    const weighted = d.value * (d.probability / 100);

    out.byStage[d.stage].count++;
    out.byStage[d.stage].value += d.value;
    out.byStage[d.stage].weighted += weighted;

    const sourceKey = (d.source as DealSource | null) ?? 'OTHER';
    if (!out.bySource[sourceKey]) out.bySource[sourceKey] = { count: 0, value: 0 };
    out.bySource[sourceKey].count++;
    out.bySource[sourceKey].value += d.value;

    if (d.stage === 'WON') {
      out.wonCount++;
      out.wonValue += d.value;
      if (typeof d.salesCycleDays === 'number') wonCycleDays.push(d.salesCycleDays);
    } else if (d.stage === 'LOST') {
      out.lostCount++;
      out.lostValue += d.value;
      const reason = (d.lostReasonCode as DealLossReason | null) ?? 'OTHER';
      out.lossReasons[reason] = (out.lossReasons[reason] ?? 0) + 1;
    } else {
      // open
      out.openDeals++;
      out.pipelineValueRaw += d.value;
      out.pipelineValueWeighted += weighted;
    }
  }

  // Conversion: of CLOSED deals (won + lost), how many were won?
  const closed = out.wonCount + out.lostCount;
  out.conversionRate = closed > 0 ? Math.round((out.wonCount / closed) * 100) : 0;

  out.avgSalesCycleDays = wonCycleDays.length > 0
    ? Math.round(wonCycleDays.reduce((a, b) => a + b, 0) / wonCycleDays.length)
    : 0;

  // Top 5 open deals by weighted value.
  out.topOpenDeals = snapshot.deals
    .filter((d) => d.stage !== 'WON' && d.stage !== 'LOST')
    .map((d) => ({
      id: d.id,
      title: d.title,
      value: d.value,
      weighted: d.value * (d.probability / 100),
      probability: d.probability,
      stage: d.stage,
    }))
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 5);

  return out;
}

/**
 * Default probabilities per stage. Used by `DealsService.moveStage` when the
 * caller doesn't override and the user/AI hasn't manually set a value.
 */
export const STAGE_DEFAULT_PROBABILITY: Record<DealStage, number> = {
  LEAD_IN: 10,
  QUALIFIED: 30,
  PROPOSAL: 50,
  NEGOTIATION: 70,
  WON: 100,
  LOST: 0,
};
