import { describe, expect, test } from "bun:test";
import { readConfig } from "./config";

const valid = {
  AUTH_DATABASE_URL: "postgres://unused",
  AUTH_BASE_URL: "https://chat.example.com",
  AUTH_SECRET: "test-only-secret-at-least-32-characters",
};
describe("AUTH configuration", () => {
  test("requires strong secret and explicit connection settings", () => {
    expect(() => readConfig({ ...valid, AUTH_SECRET: "short" })).toThrow();
    expect(() => readConfig({})).toThrow();
  });
  test("rejects insecure remote origins and credential-bearing URLs", () => {
    for (const base of [
      "http://chat.example.com",
      "https://user:pass@chat.example.com",
      "https://chat.example.com/path",
      "https://chat.example.com?secret=x",
    ]) {
      expect(() => readConfig({ ...valid, AUTH_BASE_URL: base })).toThrow();
    }
  });
  test("allows HTTPS and explicit loopback development", () => {
    expect(readConfig(valid).baseURL).toBe("https://chat.example.com");
    expect(readConfig({ ...valid, AUTH_BASE_URL: "http://127.0.0.1:5173" }).port).toBe(3001);
  });
});

test("database password remains data rather than URL syntax", () => {
  const password = "p@ss/#?:% word'\\$";
  const config = readConfig({
    ...valid,
    AUTH_DATABASE_URL: "postgres://yapper_auth@postgres:5432/yapper_auth",
    AUTH_DATABASE_PASSWORD: password,
  });
  const database = new URL(config.databaseURL);
  expect(decodeURIComponent(database.password)).toBe(password);
  expect(database.hostname).toBe("postgres");
  expect(database.pathname).toBe("/yapper_auth");
});
