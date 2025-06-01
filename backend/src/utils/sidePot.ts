export interface SidePot {
  amount: number;
  eligibleIds: string[];
}

/**
 * 根据每个玩家的总投注额计算主池和侧池
 * @param totalBets 玩家总投注记录（playerId -> 总投注额）
 * @param activeIds 在摊牌阶段仍未弃牌的玩家ID列表
 * @returns 侧池数组，每个包含池金额和有资格赢得该池的玩家ID列表
 */
export function splitPotSidePots(
  totalBets: Record<string, number>,
  activeIds: string[]
): SidePot[] {
  // 获取所有投注额条目
  const entries = Object.entries(totalBets).map(([pid, amt]) => ({ pid, amt }));
  // 按投注额从小到大排序并去重
  const uniqueAmounts = Array.from(
    new Set(entries.map(e => e.amt))
  ).sort((a, b) => a - b);

  const sidePots: SidePot[] = [];
  let prevAmount = 0;

  for (const amount of uniqueAmounts) {
    // 计算至少贡献该投注额的玩家
    const eligibleAll = entries.filter(e => e.amt >= amount).map(e => e.pid);
    if (eligibleAll.length === 0) {
      prevAmount = amount;
      continue;
    }
    // 当前侧池金额 = (amount - prevAmount) * 贡献玩家数量
    const potAmount = (amount - prevAmount) * eligibleAll.length;
    sidePots.push({ amount: potAmount, eligibleIds: eligibleAll.filter(pid => activeIds.includes(pid)) });
    prevAmount = amount;
  }

  return sidePots;
} 