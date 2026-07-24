import { logger } from "./logger";

export interface CapitalSession {
  cst: string;
  securityToken: string;
  expiresAt: number;
}

export interface CapitalCandle {
  snapshotTime: string;
  openPrice: { bid: number; ask: number };
  highPrice: { bid: number; ask: number };
  lowPrice: { bid: number; ask: number };
  closePrice: { bid: number; ask: number };
  lastTradedVolume: number;
}

export interface CapitalPosition {
  position: {
    dealId: string;
    size: number;
    direction: string;
    openLevel: number;
    openDate: string;
    stopLevel?: number;
    limitLevel?: number;
    currency: string;
    profit?: number;
    limitedRiskPremium?: number;
    controlledRisk: boolean;
    trailingStep?: number;
    trailingStopDistance?: number;
  };
  market: {
    epic: string;
    instrumentName: string;
    bid: number;
    offer: number;
    high: number;
    low: number;
    percentageChange: number;
    netChange: number;
    marketStatus: string;
  };
}

export interface CapitalMarket {
  epic: string;
  instrumentName: string;
  bid: number;
  offer: number;
  high: number;
  low: number;
  percentageChange: number;
  netChange: number;
  marketStatus: string;
  scalingFactor?: number;
}

export interface CapitalAccount {
  accountId: string;
  accountName: string;
  status: string;
  accountType: string;
  preferred: boolean;
  balance: {
    balance: number;
    deposit: number;
    profitLoss: number;
    available: number;
  };
  currency: string;
  canTransferFrom: boolean;
  canTransferTo: boolean;
}

export class CapitalApiClient {
  private session: CapitalSession | null = null;
  private baseUrl: string;
  private apiKey: string;
  private identifier: string;
  private password: string;
  private sessionRefreshInterval: NodeJS.Timeout | null = null;

  constructor(baseUrl: string, apiKey: string, identifier: string, password: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.apiKey = apiKey;
    this.identifier = identifier;
    this.password = password;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requiresAuth = true
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-CAP-API-KEY": this.apiKey,
    };

    if (requiresAuth && this.session) {
      headers["CST"] = this.session.cst;
      headers["X-SECURITY-TOKEN"] = this.session.securityToken;
    }

    const url = `${this.baseUrl}/api/v1${path}`;
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Capital.com API error ${response.status}: ${errText}`);
    }

    // Some endpoints return empty body on success
    const text = await response.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }

  async createSession(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/v1/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAP-API-KEY": this.apiKey,
      },
      body: JSON.stringify({
        identifier: this.identifier,
        password: this.password,
        encryptedPassword: false,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Failed to create Capital.com session: ${response.status} ${errText}`);
    }

    const cst = response.headers.get("CST");
    const securityToken = response.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      throw new Error("Capital.com session missing CST or X-SECURITY-TOKEN headers");
    }

    this.session = {
      cst,
      securityToken,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    };

    logger.info("Capital.com session created successfully");
  }

  async ensureSession(): Promise<void> {
    if (!this.session || Date.now() > this.session.expiresAt - 60_000) {
      await this.createSession();
    }
  }

  isSessionValid(): boolean {
    return !!this.session && Date.now() < this.session.expiresAt - 30_000;
  }

  async getAccounts(): Promise<CapitalAccount[]> {
    await this.ensureSession();
    const data = await this.request<{ accounts: CapitalAccount[] }>("GET", "/accounts");
    return data.accounts || [];
  }

  async getPositions(): Promise<CapitalPosition[]> {
    await this.ensureSession();
    const data = await this.request<{ positions: CapitalPosition[] }>("GET", "/positions");
    return data.positions || [];
  }

  async createPosition(params: {
    epic: string;
    direction: "BUY" | "SELL";
    size: number;
    stopLevel?: number;
    profitLevel?: number;
    trailingStopDistance?: number;
  }): Promise<{ dealReference: string }> {
    await this.ensureSession();
    return this.request<{ dealReference: string }>("POST", "/positions", {
      epic: params.epic,
      direction: params.direction,
      size: params.size,
      stopLevel: params.stopLevel,
      profitLevel: params.profitLevel,
      guaranteedStop: false,
      trailingStop: params.trailingStopDistance !== undefined,
      trailingStopDistance: params.trailingStopDistance,
    });
  }

  async closePosition(dealId: string): Promise<void> {
    await this.ensureSession();
    await this.request<unknown>("DELETE", `/positions/${dealId}`);
  }

  async getMarketData(epics: string[]): Promise<CapitalMarket[]> {
    await this.ensureSession();
    const epicStr = epics.join(",");
    const data = await this.request<{ markets: CapitalMarket[] }>(
      "GET",
      `/markets?searchTerm=${epicStr}&epics=${epicStr}`
    );
    return data.markets || [];
  }

  async getSingleMarket(epic: string): Promise<CapitalMarket | null> {
    await this.ensureSession();
    try {
      const data = await this.request<{ instrument: CapitalMarket & { epic: string }; snapshot: { bid: number; offer: number; high: number; low: number; netChange: number; percentageChange: number; marketStatus: string } }>(
        "GET",
        `/markets/${epic}`
      );
      if (!data.instrument) return null;
      return {
        epic: data.instrument.epic || epic,
        instrumentName: (data.instrument as unknown as { name?: string; instrumentName?: string }).name || (data.instrument as unknown as { name?: string; instrumentName?: string }).instrumentName || epic,
        bid: data.snapshot?.bid ?? 0,
        offer: data.snapshot?.offer ?? 0,
        high: data.snapshot?.high ?? 0,
        low: data.snapshot?.low ?? 0,
        percentageChange: data.snapshot?.percentageChange ?? 0,
        netChange: data.snapshot?.netChange ?? 0,
        marketStatus: data.snapshot?.marketStatus ?? "OFFLINE",
      };
    } catch {
      return null;
    }
  }

  async getCandles(
    epic: string,
    resolution: "MINUTE" | "MINUTE_5" | "MINUTE_15" | "MINUTE_30" | "HOUR" | "HOUR_4" | "DAY" | "WEEK" | "MONTH",
    max: number = 200
  ): Promise<CapitalCandle[]> {
    await this.ensureSession();
    const data = await this.request<{ prices: CapitalCandle[] }>(
      "GET",
      `/prices/${epic}?resolution=${resolution}&max=${max}`
    );
    return data.prices || [];
  }

  async getDealConfirmation(dealReference: string): Promise<{ dealId: string; status: string; profit?: number }> {
    await this.ensureSession();
    return this.request<{ dealId: string; status: string; profit?: number }>(
      "GET",
      `/confirms/${dealReference}`
    );
  }

  destroy(): void {
    if (this.sessionRefreshInterval) {
      clearInterval(this.sessionRefreshInterval);
    }
  }
}
