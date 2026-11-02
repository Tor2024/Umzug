import { describe, expect, it } from "vitest";
import { rankCandidates, type CandidateVehicle } from "@/lib/dispatch-optimizer";

type Base = Omit<CandidateVehicle, "approachKm" | "approachMin" | "approachCostCents" | "score" | "optimal"> & {
  approach: { km: number; min: number } | null;
};

function base(id: number, approach: { km: number; min: number } | null): Base {
  return {
    id,
    plate: `B-MA ${1000 + id}`,
    label: "LKW 7,5 t",
    vehicleClass: "B",
    capacityM3: 35,
    currentLocation: "Berlin",
    approach,
  };
}

describe("rankCandidates (умный подбор машин)", () => {
  it("сортирует по холостому пробегу: ближе — раньше", () => {
    const ranked = rankCandidates([base(1, { km: 50, min: 40 }), base(2, { km: 5, min: 8 }), base(3, { km: 20, min: 15 })]);
    expect(ranked.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it("машины без рассчитанного подхода уходят в конец", () => {
    const ranked = rankCandidates([base(1, null), base(2, { km: 30, min: 25 }), base(3, null)]);
    expect(ranked.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(ranked[1].score).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("optimal — машина с минимальным холостым пробегом", () => {
    const ranked = rankCandidates([base(1, null), base(2, { km: 30, min: 25 }), base(3, { km: 10, min: 9 })]);
    expect(ranked.find((r) => r.id === 3)?.optimal).toBe(true);
    expect(ranked.find((r) => r.id === 2)?.optimal).toBe(false);
    expect(ranked.find((r) => r.id === 1)?.optimal).toBe(false);
  });

  it("если никто не рассчитан — optimal ни у кого", () => {
    const ranked = rankCandidates([base(1, null), base(2, null)]);
    expect(ranked.every((r) => !r.optimal)).toBe(true);
  });

  it("себестоимость подачи = км × 1.04 € (104 цента)", () => {
    const ranked = rankCandidates([base(1, { km: 10, min: 8 })]);
    expect(ranked[0].approachCostCents).toBe(1040);
  });

  it("пустой список — пустой результат", () => {
    expect(rankCandidates([])).toEqual([]);
  });
});
