export const LOTTERY_PRICE = 2.5;

function amountsFor(plan) {
  const amounts = [];
  const currency = String(plan.currency || plan.pricing?.price?.currency || "").toUpperCase();
  for (const variant of plan.pricingVariants || []) {
    for (const strategy of variant.pricingStrategies || []) {
      const amount = strategy?.flatRate?.amount;
      if (amount != null && amount !== "") amounts.push(Number(amount));
    }
  }
  const legacy = plan.pricing?.price?.value;
  if (legacy != null && legacy !== "") amounts.push(Number(legacy));
  return { currency, amounts: amounts.filter((amount) => Number.isFinite(amount)) };
}

function isLotteryPrice(plan) {
  const { currency, amounts } = amountsFor(plan);
  return currency === "GBP" && amounts.some((amount) => Math.abs(amount - LOTTERY_PRICE) < 0.001);
}

function nameHasLottery(plan) {
  return /lottery/i.test(String(plan.name || ""));
}

export function selectLotteryPlan(plans, configuredId) {
  const list = Array.isArray(plans) ? plans : [];
  const id = String(configuredId || "").trim();

  if (id) {
    const match = list.find((plan) => plan.id === id);
    if (match) {
      return {
        id: match.id,
        name: match.name || "Lottery plan",
        matchedBy: "WIX_LOTTERY_PLAN_ID",
      };
    }
    return {
      id,
      name: "Configured lottery plan",
      matchedBy: "WIX_LOTTERY_PLAN_ID",
      missingFromList: true,
    };
  }

  const priced = list.filter(isLotteryPrice);
  const pricedAndNamed = priced.filter(nameHasLottery);
  if (pricedAndNamed.length > 0) {
    return {
      id: pricedAndNamed[0].id,
      name: pricedAndNamed[0].name,
      matchedBy: "price 2.50 GBP and name contains lottery",
      ambiguous: pricedAndNamed.length > 1,
    };
  }
  if (priced.length > 0) {
    return {
      id: priced[0].id,
      name: priced[0].name,
      matchedBy: "price 2.50 GBP",
      ambiguous: priced.length > 1,
    };
  }

  const named = list.filter(nameHasLottery);
  if (named.length > 0) {
    return {
      id: named[0].id,
      name: named[0].name,
      matchedBy: "name contains lottery",
      ambiguous: named.length > 1,
    };
  }

  return null;
}
