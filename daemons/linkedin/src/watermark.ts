import * as fs from "fs";

type WatermarkData = Record<string, number>; // contactId → epoch ms

export class WatermarkStore {
  private data: WatermarkData = {};

  constructor(private filePath: string) {
    this.load();
  }

  get(contactId: string): number | null {
    return this.data[contactId] ?? null;
  }

  set(contactId: string, timestamp: number): void {
    this.data[contactId] = timestamp;
    this.save();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        this.data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      }
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }
}
