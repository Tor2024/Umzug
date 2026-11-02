import { describe, expect, it } from "vitest";
import { isValidLatinName } from "../src/lib/validate";

describe("isValidLatinName", () => {
  it("принимает имя + фамилию латиницей", () => {
    expect(isValidLatinName("Anna Safrova")).toBe(true);
    expect(isValidLatinName("Oleh Kalchenko")).toBe(true);
  });

  it("принимает дефисы, апострофы, точки", () => {
    expect(isValidLatinName("Anna-Marie Schmidt-Lenz")).toBe(true);
    expect(isValidLatinName("D'Artagnan Rossi")).toBe(true);
  });

  it("отклоняет инициалы (нужны полные имена для документов)", () => {
    expect(isValidLatinName("Anna M. Safrova")).toBe(false);
  });

  it("отклоняет кириллицу", () => {
    expect(isValidLatinName("Анна Сафрова")).toBe(false);
    expect(isValidLatinName("Anna Сафрова")).toBe(false);
  });

  it("отклоняет одно слово и пустоту", () => {
    expect(isValidLatinName("Anna")).toBe(false);
    expect(isValidLatinName("")).toBe(false);
    expect(isValidLatinName("   ")).toBe(false);
  });

  it("отклоняет цифры и спецсимволы", () => {
    expect(isValidLatinName("Anna 123")).toBe(false);
    expect(isValidLatinName("Anna @@@")).toBe(false);
  });

  it("отклоняет слишком короткие части", () => {
    expect(isValidLatinName("A B")).toBe(false);
    expect(isValidLatinName("Anna S")).toBe(false);
  });
});
