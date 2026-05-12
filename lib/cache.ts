import fs from "fs";
import path from "path";

const dir = path.join(process.cwd(), ".cache");

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, key.replace(/[^a-z0-9_-]/gi, "_") + ".json");
  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs < ttlMs) {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    }
  } catch {}
  const data = await fn();
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}
