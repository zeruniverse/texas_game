// 实现德州扑克手牌比较算法
export function evaluateHand(cards: string[]): number {
  // 牌面映射
  const rankMap: Record<string, number> = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
  // 解析手牌
  const parsed = cards.map(c => {
    const suit = c.slice(-1);
    const rankStr = c.slice(0, -1);
    return { rank: rankMap[rankStr], suit };
  });
  // 生成所有 5 张组合
  const combos: { rank: number; suit: string }[][] = [];
  const n = parsed.length;
  function gen(start: number, chosen: any[]) {
    if (chosen.length === 5) {
      combos.push(chosen.slice()); return;
    }
    for (let i = start; i < n; i++) {
      chosen.push(parsed[i]);
      gen(i+1, chosen);
      chosen.pop();
    }
  }
  gen(0, []);

  let bestScore = 0;
  // 计算单组得分
  function scoreFive(cards5: { rank: number; suit: string }[]): number {
    const ranks = cards5.map(c=>c.rank).sort((a,b)=>b-a);
    const suits = cards5.map(c=>c.suit);
    const counts: Record<number, number> = {};
    ranks.forEach(r=>counts[r]=(counts[r]||0)+1);
    const uniqueRanks = Object.keys(counts).map(x=>parseInt(x)).sort((a,b)=>b-a);
    const isFlush = suits.every(s=>s===suits[0]);
    // straight 检测
    let isStraight = false;
    let highStraight = 0;
    const uniq = Array.from(new Set(ranks)).sort((a,b)=>a-b);
    for (let i=0;i<=uniq.length-5;i++) {
      if (uniq[i+4] - uniq[i] === 4) {
        isStraight = true;
        highStraight = uniq[i+4];
      }
    }
    // A-2-3-4-5
    if (!isStraight && uniq.slice(-4).toString()=== '2,3,4,5' && uniq.includes(14)) {
      isStraight = true;
      highStraight = 5;
    }
    // 统计数量
    const countVals = Object.values(counts).sort((a,b)=>b-a);
    const [c1,c2] = countVals;
    let score = 0;
    // 分类得分基数
    if (isStraight && isFlush) score = 8e12 + highStraight;
    else if (c1===4) {
      const four = uniqueRanks.find(r=>counts[r]===4)!;
      score = 7e12 + four*1e8 + uniqueRanks.find(r=>counts[r]!==4)!;
    }
    else if (c1===3 && c2===2) {
      const three = uniqueRanks.find(r=>counts[r]===3)!;
      const two = uniqueRanks.find(r=>counts[r]===2)!;
      score = 6e12 + three*1e8 + two;
    }
    else if (isFlush) score = 5e12 + ranks[0]*1e8 + ranks[1]*1e6 + ranks[2]*1e4 + ranks[3]*1e2 + ranks[4];
    else if (isStraight) score = 4e12 + highStraight;
    else if (c1===3) {
      const three = uniqueRanks.find(r=>counts[r]===3)!;
      const kickers = uniqueRanks.filter(r=>counts[r]===1).slice(0,2);
      score = 3e12 + three*1e8 + kickers[0]*1e6 + kickers[1]*1e4;
    }
    else if (c1===2 && c2===2) {
      const pairs = uniqueRanks.filter(r=>counts[r]===2).slice(0,2);
      const kicker = uniqueRanks.find(r=>counts[r]===1)!;
      score = 2e12 + pairs[0]*1e8 + pairs[1]*1e6 + kicker*1e4;
    }
    else if (c1===2) {
      const pair = uniqueRanks.find(r=>counts[r]===2)!;
      const kickers = uniqueRanks.filter(r=>counts[r]===1).slice(0,3);
      score = 1e12 + pair*1e8 + kickers[0]*1e6 + kickers[1]*1e4 + kickers[2]*1e2;
    }
    else {
      score = ranks[0]*1e8 + ranks[1]*1e6 + ranks[2]*1e4 + ranks[3]*1e2 + ranks[4];
    }
    return score;
  }
  combos.forEach(c5=>{
    const s = scoreFive(c5);
    if (s>bestScore) bestScore = s;
  });
  return bestScore;
}