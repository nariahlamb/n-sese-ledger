import { resolveTable, type BookModel } from './book';

export interface FieldContractItem {
  table: string;
  column?: string;
  feature: string;
  required?: boolean;
}

export interface RegisteredFieldContract {
  pluginId: string;
  label: string;
  items: FieldContractItem[];
}

export interface FieldContractHealth extends FieldContractItem {
  pluginId: string;
  label: string;
  tablePresent: boolean;
  columnPresent: boolean;
  missing: boolean;
  observedMissing: boolean;
  missingCount: number;
}

export interface FieldContractImpact extends FieldContractItem {
  pluginId: string;
  label: string;
  kind: 'rename' | 'delete';
  to?: string;
}

export interface FieldContractRegistry {
  version: 1;
  register(pluginId: string, label: string, items: FieldContractItem[]): void;
  reportMissing(pluginId: string, table: string, column?: string, feature?: string): void;
  list(): RegisteredFieldContract[];
  health(): FieldContractHealth[];
  impacts(changes: { table: string; column?: string; toTable?: string; toColumn?: string; kind: 'rename' | 'delete' }[]): FieldContractImpact[];
  /** 台账消费方：运行时字段发现即登记，按字段本身去重合并。 */
  register(items: FieldContractItem[]): void;
}

function text(value: unknown): string { return String(value ?? '').trim(); }

export function createFieldContractRegistry(getBook: () => BookModel | null): FieldContractRegistry {
  const contracts = new Map<string, RegisteredFieldContract>();
  const observed = new Map<string, { count: number; feature: string }>();
  const addItems = (items: FieldContractItem[]): void => {
    const contract = contracts.get("n-sese-ledger") || { pluginId: "n-sese-ledger", label: "瑟瑟台账", items: [] };
    const seen = new Set(contract.items.map(item => JSON.stringify([item.table, item.column || "", item.feature, item.required])));
    for (const raw of items) {
      const item = { table: text(raw?.table), column: text(raw?.column) || undefined, feature: text(raw?.feature) || "未注明功能", required: raw?.required === true };
      const key = JSON.stringify([item.table, item.column || "", item.feature, item.required]);
      if (!item.table || seen.has(key)) continue;
      seen.add(key);
      contract.items.push(item);
    }
    contracts.set(contract.pluginId, contract);
  };
  const register = (pluginId: string, label: string, items: FieldContractItem[]): void => {

      const id = text(pluginId);
      if (!id || !Array.isArray(items)) return;
      const seen = new Set<string>();
      const normalized = items.map(item => ({
        table: text(item?.table), column: text(item?.column) || undefined,
        feature: text(item?.feature) || '未注明功能', required: item?.required === true,
      })).filter(item => {
        if (!item.table) return false;
        const key = JSON.stringify([item.table, item.column || '', item.feature, item.required]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (id === "n-sese-ledger") { addItems(normalized); return; }
      contracts.set(id, { pluginId: id, label: text(label) || id, items: normalized });
  };
  const api: FieldContractRegistry = {
    version: 1,
    register,
    reportMissing(pluginId, table, column, feature) {
      const id = text(pluginId);
      const name = text(table);
      const col = text(column);
      if (!id || !name) return;
      const key = JSON.stringify([id, name, col]);
      const previous = observed.get(key);
      observed.set(key, { count: (previous?.count || 0) + 1, feature: text(feature) || previous?.feature || '' });
    },
    list() {
      return [...contracts.values()].map(contract => ({ ...contract, items: contract.items.map(item => ({ ...item })) }));
    },
    health() {
      const book = getBook();
      return this.list().flatMap(contract => contract.items.map(item => {
        const table = book ? resolveTable(book, item.table) : null;
        const headers = table?.headers || [];
        const observedMissing = [...observed.entries()].some(([key, value]) => {
          const [id, name, col] = JSON.parse(key) as string[];
          return id === contract.pluginId && name === item.table && col === (item.column || '')
            && (!item.feature || !value.feature || value.feature === item.feature);
        });
        const tablePresent = !!table;
        const columnPresent = tablePresent && (!item.column || headers.includes(item.column));
        const missingCount = [...observed.entries()].reduce((sum, [key, value]) => {
          const [id, name, col] = JSON.parse(key) as string[];
          return id === contract.pluginId && name === item.table && col === (item.column || '')
            && (!item.feature || !value.feature || value.feature === item.feature) ? sum + value.count : sum;
        }, 0);
        return { ...item, pluginId: contract.pluginId, label: contract.label, tablePresent, columnPresent,
          missing: !tablePresent || !columnPresent, observedMissing, missingCount };
      }));
    },
    impacts(changes) {
      const out: FieldContractImpact[] = [];
      const seen = new Set<string>();
      for (const contract of contracts.values()) {
        for (const item of contract.items) {
          for (const change of changes) {
            if (item.table !== change.table) continue;
            if (change.column) { if (item.column !== change.column) continue; }
            else if (!change.toTable && item.column) { /* 删整表影响表内全部字段 */ }
            const impact = { ...item, pluginId: contract.pluginId, label: contract.label, kind: change.kind,
              ...(change.column ? { to: change.toColumn } : { to: change.toTable }) };
            const key = JSON.stringify([impact.pluginId, impact.feature, impact.table, impact.column, impact.kind, impact.to]);
            if (!seen.has(key)) { seen.add(key); out.push(impact); }
          }
        }
      }
      return out;
    },
  };
  api.register = ((...args: [string, string, FieldContractItem[]] | [FieldContractItem[]]) => {
    if (Array.isArray(args[0])) addItems(args[0]);
    else register(args[0], args[1], args[2]);
  }) as FieldContractRegistry["register"];
  return api;
}
