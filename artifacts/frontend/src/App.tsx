import {
  Fragment,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  getGetAddressMetadataQueryKey,
  getGetBlockscoutStatusQueryKey,
  getGetWalletOverviewQueryKey,
  useGetAddressMetadata,
  useGetBlockscoutStatus,
  useGetWalletOverview,
  setBaseUrl,
} from '@workspace/api-client-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleHelp,
  Copy,
  ExternalLink,
  Fingerprint,
  Globe2,
  KeyRound,
  Link2,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

setBaseUrl(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000');
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 0,
      refetchOnWindowFocus: false,
    },
  },
});

const LOADING_TIMEOUT_MS = 15_000;

const DEMO_WALLETS = [
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'Multi-Chain DeFi', address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
];

const validAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address.trim());
const compactAddress = (address: string) => `${address.slice(0, 7)}…${address.slice(-5)}`;
const numericValue = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const currency = (value: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value > 1000 ? 0 : 2,
  }).format(value);
const quantity = (value: string | number, maximumFractionDigits = 5) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(numericValue(value));

function Dashboard() {
  const [draft, setDraft] = useState('');
  const [submittedAddress, setSubmittedAddress] = useState('');
  const [validationError, setValidationError] = useState('');
  const [identityAddress, setIdentityAddress] = useState('');
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'risks' | 'approvals' | 'linkability' | 'history'>('overview');

  const blockscout = useGetBlockscoutStatus({
    query: { queryKey: getGetBlockscoutStatusQueryKey(), retry: 1 },
  });

  const isSourceReady = blockscout.data?.configured !== false;

  const walletQuery = useGetWalletOverview(submittedAddress, {
    query: {
      queryKey: getGetWalletOverviewQueryKey(submittedAddress),
      enabled: validAddress(submittedAddress) && isSourceReady,
      retry: 0,
    },
  });

  const metadataQuery = useGetAddressMetadata(identityAddress, {
    query: {
      queryKey: getGetAddressMetadataQueryKey(identityAddress),
      enabled: Boolean(identityAddress),
      retry: 1,
    },
  });

  useEffect(() => {
    if (!walletQuery.isFetching) {
      setElapsedMs(0);
      return;
    }
    setTimedOut(false);
    const start = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - start;
      setElapsedMs(elapsed);
      if (elapsed >= LOADING_TIMEOUT_MS) {
        setTimedOut(true);
        void queryClient.cancelQueries({
          queryKey: getGetWalletOverviewQueryKey(submittedAddress),
        });
        window.clearInterval(interval);
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [walletQuery.isFetching, submittedAddress]);

  const overview = walletQuery.data;
  const chains = overview?.chains ?? [];
  const approvals = overview?.approvals ?? [];
  const poisoningMatches = overview?.poisoningMatches ?? [];
  const linkability = overview?.linkability;
  const history = overview?.history ?? [];

  const riskSignals = useMemo(() => {
    const list: Array<{
      id: string;
      severity: string;
      title: string;
      description: string;
      chainName: string;
      explorerTxUrl?: string;
      explorerAddressUrl?: string;
    }> = [];

    for (const p of poisoningMatches) {
      list.push({
        id: `poison-${p.chainId}-${p.hash}`,
        severity: p.isZeroValue ? 'critical' : 'high',
        title: `Address Poisoning Lookalike (${p.prefixMatch} prefix / ${p.suffixMatch} suffix match)`,
        description: `Address ${compactAddress(p.suspiciousAddress)} closely mimics known counterparty ${compactAddress(p.mimickedAddress)} on ${p.chainName}.`,
        chainName: p.chainName,
        explorerTxUrl: p.txExplorerUrl,
        explorerAddressUrl: p.suspiciousExplorerUrl,
      });
    }

    for (const a of approvals) {
      if (a.allowanceType === 'unlimited') {
        list.push({
          id: `approval-${a.chainId}-${a.hash}`,
          severity: 'high',
          title: `Unlimited Token Approval on ${a.chainName}`,
          description: `Spender ${compactAddress(a.spenderAddress)} has an active unlimited allowance (${a.formattedAllowance}) for token ${compactAddress(a.tokenAddress)}.`,
          chainName: a.chainName,
          explorerTxUrl: a.txExplorerUrl,
          explorerAddressUrl: a.spenderExplorerUrl,
        });
      }
    }

    return list;
  }, [poisoningMatches, approvals]);

  const holdings = useMemo(() => {
    const assets: {
      key: string;
      address: string;
      name: string;
      symbol: string;
      amount: string | null;
      value: number | null;
      iconUrl: string | null;
      chain: string;
      chainId: number | string;
      native: boolean;
      explorerUrl?: string;
    }[] = [];
    for (const chain of chains) {
      const nativeAmount = numericValue(chain.nativeBalance);
      const nativePrice = chain.nativePriceUsd;
      assets.push({
        key: `native-${chain.chainId}`,
        address: submittedAddress,
        name: chain.chainName,
        symbol: chain.nativeSymbol,
        amount: chain.nativeBalance,
        value:
          chain.nativeBalance === null || nativePrice === null
            ? null
            : nativeAmount * nativePrice,
        iconUrl: null,
        chain: chain.chainName,
        chainId: chain.chainId,
        native: true,
        explorerUrl: (chain as any).addressExplorerUrl,
      });
      for (const token of (chain.tokens ?? []) as any[]) {
        assets.push({
          key: `${chain.chainId}-${token.address}`,
          address: token.address,
          name: token.name,
          symbol: token.symbol,
          amount: token.balance,
          value: token.valueUsd,
          iconUrl: token.iconUrl,
          chain: chain.chainName,
          chainId: chain.chainId,
          native: false,
          explorerUrl: token.explorerTokenUrl,
        });
      }
    }
    return assets;
  }, [chains, submittedAddress]);

  const totalValue = holdings.reduce((total, item) => total + (item.value ?? 0), 0);
  const valuedAssets = holdings.filter((item) => item.value !== null && item.value > 0);
  const allocationColors = ['#26776e', '#dc714d', '#718a96', '#d4a545', '#8a789f', '#4b9990'];

  const transactions = useMemo(
    () =>
      chains
        .flatMap((chain) =>
          ((chain.transactions ?? []) as any[]).map((tx) => ({
            ...tx,
            chain: chain.chainName,
            chainId: chain.chainId,
          })),
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
    [chains],
  );

  const lifetimeTxCount =
    (overview as any)?.totalLifetimeTransactions ??
    chains.reduce((acc, c) => acc + ((c as any).totalTransactionsCount ?? c.transactions?.length ?? 0), 0);

  const hasPartialChains =
    chains.some(
      (chain) =>
        chain.nativeBalance === null ||
        chain.nativePriceUsd === null ||
        chain.tokenBalancesIncomplete,
    ) || holdings.some((asset) => asset.value === null);

  const holdingsByChain = chains.map((chain) => ({
    chain,
    assets: holdings.filter((asset) => asset.chain === chain.chainName),
  }));

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!validAddress(value)) {
      setValidationError('Enter a valid 0x address (42 characters).');
      return;
    }
    setValidationError('');
    setTimedOut(false);
    setSubmittedAddress(value);
  };

  const selectDemoWallet = (address: string) => {
    setDraft(address);
    setValidationError('');
    setTimedOut(false);
    setSubmittedAddress(address);
  };

  const openIdentity = () => {
    if (submittedAddress) setIdentityAddress(submittedAddress);
  };

  const copyAddress = async () => {
    if (!identityAddress) return;
    try {
      await navigator.clipboard.writeText(identityAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const queryError = walletQuery.error as Error | null;
  const metadata = metadataQuery.data;

  return (
    <div className="app-shell min-h-[100dvh]">
      <aside className="sidebar">
        <Link href="/" className="brand-lockup" data-testid="link-brand-dashboard">
          <img src="/logo.png" alt="" className="brand-mark" />
          <span className="brand-word">
            Chain<span>Lens</span>
          </span>
        </Link>
        <div className="side-rule" />
        <div className="side-caption">WORKSPACE</div>
        <Link
          href="/dashboard"
          className="nav-item nav-active"
          data-testid="link-nav-investigate"
        >
          <Fingerprint size={17} strokeWidth={1.8} />
          <span>Investigate</span>
          <span className="nav-indicator" />
        </Link>
        <div className="sidebar-bottom">
          <div className="instrument-card">
            <div className="instrument-top">
              <span className="live-dot" /> DATA SOURCE
            </div>
            {blockscout.isLoading ? (
              <div className="source-message" data-testid="status-blockscout-loading">
                Checking connection…
              </div>
            ) : blockscout.isError ? (
              <button
                className="source-error"
                onClick={() => blockscout.refetch()}
                data-testid="button-retry-blockscout"
              >
                <AlertCircle size={14} /> Connection status unavailable · retry
              </button>
            ) : isSourceReady ? (
              <div
                className="source-message"
                data-testid="status-blockscout-configured"
              >
                10+ Blockscout networks active
              </div>
            ) : (
              <div
                className="source-message source-warning"
                data-testid="status-blockscout-unconfigured"
              >
                API Key is not set
              </div>
            )}
            <p>Read-only · 10+ EVM chains via Blockscout</p>
          </div>
          <div className="side-foot">
            <span>CHAINLENS</span>
            <span>v2.0 / 10+ CHAINS</span>
          </div>
        </div>
      </aside>

      <main className="main-area shell-grid">
        <header className="topbar">
          <div className="crumb">
            <span>RESEARCH</span>
            <span className="crumb-slash">/</span>
            <b>Wallet investigation (10+ Chains)</b>
          </div>
          <div className="topbar-right">
            <span className="secure-label">
              <span className="live-dot" /> READ-ONLY SESSION
            </span>
          </div>
        </header>
        <div className="page-content">
          <div className="page-heading reveal">
            <div>
              <div className="eyebrow">
                <span className="eyebrow-line" /> MULTICHAIN FORENSICS (10+ NETWORKS)
              </div>
              <h1 className="display">
                Wallet <em>overview</em>
              </h1>
              <p className="heading-copy">
                Cross-chain holdings, poisoning detection, token approval review, Wallet Linkability Score, and historical performance charts.
              </p>
            </div>
            <div className="workspace-stamp">
              <span>CASE FILE</span>
              <strong>CL—01</strong>
              <span>PUBLIC ADDRESS INTELLIGENCE</span>
            </div>
          </div>

          <section
            className="search-panel reveal reveal-delay-1"
            aria-label="Wallet address search"
          >
            <div className="search-label-row">
              <label htmlFor="wallet-search">ADDRESS TO INVESTIGATE</label>
              <span className="search-hint">
                <CircleHelp size={13} /> Scans 10+ Blockscout EVM chains in parallel
              </span>
            </div>
            <form className="search-form" onSubmit={submitSearch}>
              <Search size={19} className="search-icon" />
              <input
                id="wallet-search"
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setValidationError('');
                }}
                placeholder="Paste wallet address  ·  0x…"
                autoComplete="off"
                spellCheck={false}
                data-testid="input-wallet-address"
              />
              <button
                type="submit"
                className="search-submit"
                disabled={walletQuery.isFetching && !timedOut}
                data-testid="button-search-wallet"
              >
                {walletQuery.isFetching && !timedOut ? 'Scanning…' : 'Investigate'}{' '}
                <ArrowRight size={16} />
              </button>
            </form>
            {validationError && (
              <div
                className="validation-note"
                role="alert"
                data-testid="error-address-validation"
              >
                <AlertCircle size={14} />
                {validationError}
              </div>
            )}
            <div className="search-foot">
              <span style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>Try sample wallet:</span>
                {DEMO_WALLETS.map((demo) => (
                  <button
                    key={demo.address}
                    type="button"
                    className="address-button mono"
                    onClick={() => selectDemoWallet(demo.address)}
                    data-testid={`button-demo-${demo.label}`}
                  >
                    {demo.label} ({compactAddress(demo.address)})
                  </button>
                ))}
              </span>
              <span className="mono">15S MAX SCAN TIME · PARALLEL ENGINE</span>
            </div>
          </section>

          {!submittedAddress && isSourceReady && (
            <section
              className="welcome-state reveal reveal-delay-2"
              data-testid="empty-investigation"
            >
              <div className="welcome-graphic" aria-hidden="true">
                <div className="orbit orbit-one" />
                <div className="orbit orbit-two" />
                <div className="orbit orbit-three" />
                <div className="orbit-core">
                  <Fingerprint size={37} strokeWidth={1.25} />
                </div>
                <span className="orbit-point point-a" />
                <span className="orbit-point point-b" />
                <span className="orbit-point point-c" />
              </div>
              <div className="welcome-copy">
                <div className="eyebrow">
                  <span className="eyebrow-line" /> READY WHEN YOU ARE
                </div>
                <h2>
                  Start with an address.
                  <br />
                  <em>Follow the evidence.</em>
                </h2>
                <p>
                  Enter any public EVM address to run parallel forensic checks across 10+ Blockscout networks, inspect active token approvals, flag address poisoning lookalikes, and evaluate cross-chain linkability.
                </p>
                <div className="welcome-details">
                  <span>
                    <span className="detail-index">01</span> 10+ CHAIN SCAN
                  </span>
                  <span>
                    <span className="detail-index">02</span> POISONING & APPROVALS
                  </span>
                  <span>
                    <span className="detail-index">03</span> LINKABILITY & CHARTS
                  </span>
                </div>
              </div>
              <div className="empty-index mono">
                NO ACTIVE
                <br />
                INVESTIGATION
              </div>
            </section>
          )}

          {submittedAddress && walletQuery.isFetching && !timedOut && (
            <section
              className="loading-dashboard"
              aria-label="Loading wallet overview"
              data-testid="state-wallet-loading"
            >
              <div className="skeleton-block skeleton-total" />
              <div className="skeleton-row">
                <div className="skeleton-block" />
                <div className="skeleton-block" />
              </div>
              <div className="skeleton-block skeleton-table" />
              <span className="loading-caption">
                <LoaderCircle size={14} className="animate-spin" /> COLLECTING PUBLIC CHAIN RECORDS ACROSS 10+ NETWORKS ({(elapsedMs / 1000).toFixed(1)}s / 15s LIMIT)
              </span>
            </section>
          )}

          {submittedAddress && (walletQuery.isError || timedOut) && (
            <section
              className="notice-panel notice-error"
              data-testid="state-wallet-error"
            >
              <div className="notice-icon">
                <AlertCircle size={20} />
              </div>
              <div>
                <h2>
                  {timedOut
                    ? 'Investigation timed out after 15 seconds'
                    : 'Couldn’t retrieve this wallet'}
                </h2>
                <p>
                  {timedOut
                    ? 'Upstream Blockscout indexers took longer than the 15-second time limit. Please retry the investigation.'
                    : queryError?.message ||
                      'The data source did not return an overview for this address. Check the address or try the request again.'}
                </p>
                <button
                  className="text-action"
                  onClick={() => {
                    setTimedOut(false);
                    void walletQuery.refetch();
                  }}
                  data-testid="button-retry-wallet"
                >
                  Retry investigation <ArrowRight size={14} />
                </button>
              </div>
            </section>
          )}

          {submittedAddress && walletQuery.isSuccess && !timedOut && (
            <div className="results-stack">
              {chains.length === 0 ? (
                <section className="notice-panel" data-testid="state-empty-wallet">
                  <div className="notice-icon">
                    <Search size={19} />
                  </div>
                  <div>
                    <h2>No supported chain records</h2>
                    <p>
                      The source returned a wallet overview, but no supported chains or balances were found for this address.
                    </p>
                  </div>
                </section>
              ) : (
                <>
                  <section
                    className="summary-grid reveal"
                    data-testid="section-wallet-summary"
                  >
                    <div className="summary-main">
                      <div className="summary-kicker">
                        <span className="eyebrow-line" /> ESTIMATED PORTFOLIO VALUE{' '}
                        <span className="quiet-badge">LIVE DATA</span>
                      </div>
                      <div className="total-value" data-testid="text-portfolio-total">
                        {currency(totalValue)}
                        <span className="estimate-mark">~</span>
                      </div>
                      <div className="summary-meta">
                        <span>
                          <span className="summary-dot" /> {chains.length}{' '}
                          {chains.length === 1 ? 'network' : 'networks'} scanned in parallel
                        </span>
                        <span>
                          {valuedAssets.length} valued{' '}
                          {valuedAssets.length === 1 ? 'asset' : 'assets'}
                        </span>
                        <span>
                          {lifetimeTxCount.toLocaleString()} total history txs ({transactions.length} recent analyzed)
                        </span>
                      </div>
                      <div className="wallet-line">
                        <span className="wallet-avatar">
                          <Fingerprint size={19} />
                        </span>
                        <button
                          className="wallet-address mono address-button"
                          onClick={openIdentity}
                          data-testid="text-wallet-address"
                        >
                          {compactAddress(submittedAddress)}
                        </button>
                        <button
                          className="identity-link"
                          onClick={openIdentity}
                          data-testid="button-open-identity"
                        >
                          <span>Address intelligence</span>
                          <ArrowRight size={14} />
                        </button>
                        <a
                          href={`https://eth.blockscout.com/address/${submittedAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="identity-link"
                          data-testid="link-explorer-wallet"
                        >
                          <span>Blockscout Explorer</span>
                          <ExternalLink size={13} />
                        </a>
                      </div>
                    </div>
                    <div className="summary-side">
                      <div className="side-stat-label">
                        NETWORK COVERAGE ({chains.length} CHAINS)
                      </div>
                      <div className="chain-badges">
                        {chains.map((chain: any) => (
                          <a
                            href={chain.addressExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="chain-pill"
                            key={chain.chainId}
                            data-testid={`badge-chain-${chain.chainId}`}
                            title={`View ${submittedAddress} on ${chain.chainName} Blockscout`}
                          >
                            <span className="chain-mark">
                              {chain.nativeSymbol.slice(0, 1)}
                            </span>
                            {chain.chainName}
                            <ExternalLink size={11} style={{ marginLeft: 4, opacity: 0.7 }} />
                          </a>
                        ))}
                      </div>
                      <div className="coverage-note">
                        <Activity size={14} />
                        <span>
                          {riskSignals.length} risk signals · {approvals.length} approvals tracked
                        </span>
                      </div>
                      {hasPartialChains && (
                        <div className="partial-note" data-testid="notice-partial-chain">
                          <AlertCircle size={13} /> Some native balances, token rows, or prices are unavailable; estimates may be incomplete.
                        </div>
                      )}
                    </div>
                  </section>

                  {/* Navigation Tabs for Investigation Sections */}
                  <div className="flex flex-wrap gap-2 border-b border-border pb-2 pt-2">
                    {[
                      { id: 'overview', label: `Portfolio & Activity` },
                      { id: 'risks', label: `Risk Signals & Poisoning (${riskSignals.length})` },
                      { id: 'approvals', label: `Token Approvals (${approvals.length})` },
                      { id: 'linkability', label: `Wallet Linkability (${linkability?.score ?? 0}/100)` },
                      { id: 'history', label: `Historical Performance Charts` },
                    ].map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as typeof activeTab)}
                        className={`px-3.5 py-2 rounded-lg text-xs font-semibold transition ${
                          activeTab === tab.id
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-card text-muted-foreground hover:bg-secondary'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* TAB 1: Overview (Holdings & Transactions) */}
                  {activeTab === 'overview' && (
                    <div className="content-grid reveal reveal-delay-1">
                      <section className="panel holdings-panel">
                        <div className="panel-heading">
                          <div>
                            <div className="section-overline">01 / PORTFOLIO</div>
                            <h2>Asset allocation</h2>
                          </div>
                          <button
                            className="panel-menu"
                            onClick={() =>
                              document
                                .getElementById('asset-list')
                                ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                            }
                            aria-label="Jump to asset list"
                            data-testid="button-jump-assets"
                          >
                            <ChevronDown size={16} />
                          </button>
                        </div>
                        {valuedAssets.length === 0 ? (
                          <div className="panel-empty" data-testid="empty-portfolio">
                            <div className="empty-ring">
                              <Activity size={17} />
                            </div>
                            <strong>No priced assets returned</strong>
                            <span>
                              Balances are present, but current price data is unavailable.
                            </span>
                          </div>
                        ) : (
                          <>
                            <div
                              className="allocation-visual"
                              data-testid="chart-token-allocation"
                            >
                              <div className="allocation-chart">
                                <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                    <Pie
                                      data={valuedAssets}
                                      dataKey="value"
                                      nameKey="symbol"
                                      innerRadius="63%"
                                      outerRadius="83%"
                                      paddingAngle={2}
                                      stroke="none"
                                      isAnimationActive={false}
                                    >
                                      {valuedAssets.map((asset, index) => (
                                        <Cell
                                          key={asset.key}
                                          fill={
                                            allocationColors[index % allocationColors.length]
                                          }
                                        />
                                      ))}
                                    </Pie>
                                    <ChartTooltip
                                      formatter={(value) => currency(Number(value))}
                                    />
                                  </PieChart>
                                </ResponsiveContainer>
                                <div className="allocation-center">
                                  <span>EST. VALUE</span>
                                  <strong>{currency(totalValue)}</strong>
                                </div>
                              </div>
                              <div className="allocation-legend">
                                {valuedAssets.slice(0, 5).map((asset, index) => (
                                  <span key={asset.key}>
                                    <i
                                      style={{
                                        background:
                                          allocationColors[index % allocationColors.length],
                                      }}
                                    />
                                    {asset.symbol}
                                  </span>
                                ))}
                                {valuedAssets.length > 5 && (
                                  <span>+{valuedAssets.length - 5} more</span>
                                )}
                              </div>
                            </div>
                            <div className="asset-list" id="asset-list">
                              <Table className="asset-table">
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Asset</TableHead>
                                    <TableHead>Balance</TableHead>
                                    <TableHead>Value</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {holdingsByChain.map(({ chain, assets }) => (
                                    <Fragment key={chain.chainId}>
                                      <TableRow className="chain-group-row">
                                        <TableCell colSpan={3}>
                                          <span className="chain-mark">
                                            {chain.nativeSymbol.slice(0, 1)}
                                          </span>
                                          {chain.chainName}
                                          <span className="chain-asset-count">
                                            {assets.length} position
                                            {assets.length === 1 ? '' : 's'}
                                          </span>
                                        </TableCell>
                                      </TableRow>
                                      {assets.map((asset, index) => (
                                        <TableRow className="asset-row" key={asset.key}>
                                          <TableCell>
                                            <div className="asset-cell">
                                              <div
                                                className="asset-icon"
                                                style={
                                                  {
                                                    '--asset-color':
                                                      allocationColors[
                                                        index % allocationColors.length
                                                      ],
                                                  } as CSSProperties
                                                }
                                              >
                                                {asset.iconUrl ? (
                                                  <img
                                                    src={asset.iconUrl}
                                                    alt=""
                                                    onError={(event) => {
                                                      event.currentTarget.style.display =
                                                        'none';
                                                    }}
                                                  />
                                                ) : (
                                                  <span>{asset.symbol.slice(0, 1)}</span>
                                                )}
                                              </div>
                                              <div className="asset-name">
                                                <strong>{asset.name}</strong>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                                  <button
                                                    className="address-button asset-address"
                                                    onClick={() =>
                                                      setIdentityAddress(asset.address)
                                                    }
                                                  >
                                                    {compactAddress(asset.address)}
                                                  </button>
                                                  {asset.explorerUrl && (
                                                    <a
                                                      href={asset.explorerUrl}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="address-button"
                                                      title="Verify on Blockscout Explorer"
                                                    >
                                                      <ExternalLink size={12} />
                                                    </a>
                                                  )}
                                                </span>
                                              </div>
                                            </div>
                                          </TableCell>
                                          <TableCell className="asset-amount mono">
                                            {asset.amount === null
                                              ? '—'
                                              : quantity(asset.amount)}{' '}
                                            <span>{asset.symbol}</span>
                                          </TableCell>
                                          <TableCell className="asset-value mono">
                                            {asset.value === null
                                              ? '—'
                                              : currency(asset.value)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </Fragment>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </>
                        )}
                        <div className="panel-foot">
                          <span>VALUES AS RETURNED BY SOURCE</span>
                          <span className="mono">
                            {holdings.length} POSITION{holdings.length === 1 ? '' : 'S'}
                          </span>
                        </div>
                      </section>

                      <section className="panel transactions-panel">
                        <div className="panel-heading transaction-heading">
                          <div>
                            <div className="section-overline">02 / RECENT ACTIVITY</div>
                            <h2>
                              Transactions{' '}
                              <span className="count-badge">{transactions.length}</span>
                            </h2>
                          </div>
                          <span className="transaction-source">
                            <span className="live-dot" /> VERIFIED BY BLOCKSCOUT
                          </span>
                        </div>
                        {transactions.length === 0 ? (
                          <div className="transaction-empty">
                            <Activity size={18} />
                            <span>
                              No recent transactions were returned for these networks.
                            </span>
                          </div>
                        ) : (
                          <div className="table-wrap">
                            <table>
                              <thead>
                                {chains.length > 0 && (
                                  <tr>
                                    <th>TRANSACTION</th>
                                    <th>NETWORK</th>
                                    <th>METHOD</th>
                                    <th>COUNTERPARTY</th>
                                    <th>VALUE</th>
                                    <th>STATUS</th>
                                  </tr>
                                )}
                              </thead>
                              <tbody>
                                {transactions.slice(0, 12).map((tx: any, index: number) => {
                                  const outgoing =
                                    tx.from.toLowerCase() ===
                                    submittedAddress.toLowerCase();
                                  const counterpart = outgoing ? tx.to : tx.from;
                                  return (
                                    <tr key={`${tx.chainId}-${tx.hash}-${index}`}>
                                      <td>
                                        <span className="tx-direction">
                                          {outgoing ? (
                                            <ArrowUpRight size={14} />
                                          ) : (
                                            <ArrowDownLeft size={14} />
                                          )}
                                        </span>
                                        <a
                                          href={tx.explorerTxUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="mono tx-hash address-button"
                                          title="Open transaction in Blockscout Explorer"
                                        >
                                          {compactAddress(tx.hash)}{' '}
                                          <ExternalLink size={12} />
                                        </a>
                                        <span className="tx-time">
                                          {new Date(tx.timestamp).toLocaleDateString(
                                            undefined,
                                            { month: 'short', day: 'numeric' },
                                          )}
                                        </span>
                                      </td>
                                      <td>
                                        <span className="table-chain">{tx.chain}</span>
                                      </td>
                                      <td>
                                        <span className="method-pill">
                                          {tx.method || 'Transfer'}
                                        </span>
                                      </td>
                                      <td className="mono counterpart">
                                        {counterpart ? (
                                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                            <button
                                              className="address-button"
                                              onClick={() =>
                                                setIdentityAddress(counterpart)
                                              }
                                            >
                                              {compactAddress(counterpart)}
                                            </button>
                                            <a
                                              href={tx.explorerToUrl || `https://eth.blockscout.com/address/${counterpart}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="address-button"
                                              title="Open counterparty in Blockscout Explorer"
                                            >
                                              <ExternalLink size={12} />
                                            </a>
                                          </span>
                                        ) : (
                                          'Contract creation'
                                        )}
                                      </td>
                                      <td className="mono tx-value">
                                        {quantity(tx.value, 6)}
                                      </td>
                                      <td>
                                        <span
                                          className={`tx-status ${
                                            String(tx.status).toLowerCase() === 'success' ||
                                            String(tx.status).toLowerCase() === 'ok'
                                              ? 'status-success'
                                              : 'status-other'
                                          }`}
                                        >
                                          <i />
                                          {tx.status}
                                        </span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="panel-foot">
                          <span>
                            LIFETIME HISTORY: {lifetimeTxCount.toLocaleString()} TXS · RECENT SAMPLE
                          </span>
                          <span className="mono">
                            {transactions.length > 12 ? 'SHOWING 12 OF ' : 'SHOWING '}
                            {transactions.length}
                          </span>
                        </div>
                      </section>
                    </div>
                  )}

                  {/* TAB 2: Risk Signals & Address Poisoning */}
                  {activeTab === 'risks' && (
                    <section className="panel" style={{ padding: '24px' }}>
                      <div className="panel-heading" style={{ marginBottom: '16px' }}>
                        <div>
                          <div className="section-overline">SECURITY FORENSICS</div>
                          <h2>Address Poisoning & Risk Signals ({riskSignals.length})</h2>
                        </div>
                        <span className="review-tag">BLOCKSCOUT VERIFIED</span>
                      </div>
                      {riskSignals.length === 0 ? (
                        <div className="panel-empty" style={{ minHeight: '140px' }}>
                          <ShieldCheck size={28} style={{ color: '#10b981', marginBottom: 8 }} />
                          <strong>No risk signals detected</strong>
                          <span>Scanned recent transaction history for address poisoning lookalikes and unrevoked unlimited allowances.</span>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: '12px' }}>
                          {riskSignals.map((signal: any) => (
                            <div
                              key={signal.id}
                              style={{
                                padding: '16px',
                                borderRadius: '8px',
                                border: '1px solid hsl(var(--border))',
                                background: 'hsl(var(--card))',
                                display: 'grid',
                                gap: '8px',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                      signal.severity === 'critical' || signal.severity === 'high'
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                    }`}
                                  >
                                    {signal.severity}
                                  </span>
                                  <strong style={{ fontSize: '13px' }}>{signal.title}</strong>
                                </div>
                                <span className="mono text-xs text-muted-foreground">{signal.chainName}</span>
                              </div>
                              <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', margin: 0 }}>
                                {signal.description}
                              </p>
                              <div style={{ display: 'flex', gap: '12px', paddingTop: '4px', fontSize: '11px' }}>
                                {signal.explorerTxUrl && (
                                  <a
                                    href={signal.explorerTxUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="identity-link"
                                    style={{ margin: 0, padding: 0 }}
                                  >
                                    <span>Verify Transaction on Blockscout</span>
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                                {signal.explorerAddressUrl && (
                                  <a
                                    href={signal.explorerAddressUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="identity-link"
                                    style={{ margin: 0, padding: 0 }}
                                  >
                                    <span>Inspect Address ({compactAddress(signal.targetAddress || '')})</span>
                                    <ExternalLink size={12} />
                                  </a>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="panel-foot" style={{ marginTop: '20px' }}>
                        <span>HEURISTIC FORENSIC ANALYSIS</span>
                        <span className="mono">{riskSignals.length} SIGNAL(S)</span>
                      </div>
                    </section>
                  )}

                  {/* TAB 3: Token Approvals */}
                  {activeTab === 'approvals' && (
                    <section className="panel" style={{ padding: '24px' }}>
                      <div className="panel-heading" style={{ marginBottom: '16px' }}>
                        <div>
                          <div className="section-overline">ALLOWANCE AUDIT</div>
                          <h2>Token Approvals & Spender Review ({approvals.length})</h2>
                        </div>
                        <span className="review-tag">CALDATA DECODED</span>
                      </div>
                      {approvals.length === 0 ? (
                        <div className="panel-empty" style={{ minHeight: '140px' }}>
                          <KeyRound size={28} style={{ color: '#10b981', marginBottom: 8 }} />
                          <strong>No active approval transactions found</strong>
                          <span>No ERC-20 / NFT approval or allowance modification logs were found in the recent sampled history.</span>
                        </div>
                      ) : (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>CHAIN</th>
                                <th>TOKEN / ASSET</th>
                                <th>SPENDER CONTRACT</th>
                                <th>ALLOWANCE STATUS</th>
                                <th>METHOD</th>
                                <th style={{ textAlign: 'right' }}>EXPLORER VERIFICATION</th>
                              </tr>
                            </thead>
                            <tbody>
                              {approvals.map((app: any) => (
                                <tr key={app.hash}>
                                  <td><strong>{app.chainName}</strong></td>
                                  <td>
                                    <a
                                      href={app.tokenExplorerUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="address-button mono"
                                    >
                                      {app.tokenAddress ? compactAddress(app.tokenAddress) : 'Token'} <ExternalLink size={12} />
                                    </a>
                                  </td>
                                  <td>
                                    <a
                                      href={app.spenderExplorerUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="address-button mono"
                                    >
                                      {compactAddress(app.spenderAddress)} <ExternalLink size={12} />
                                    </a>
                                  </td>
                                  <td>
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                        app.allowanceType === 'unlimited'
                                          ? 'bg-rose-500/20 text-rose-300'
                                          : app.allowanceType === 'revoked'
                                            ? 'bg-emerald-500/20 text-emerald-300'
                                            : 'bg-amber-500/20 text-amber-300'
                                      }`}
                                    >
                                      {app.formattedAllowance}
                                    </span>
                                  </td>
                                  <td className="mono">{app.method}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    <a
                                      href={app.txExplorerUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="identity-link"
                                      style={{ display: 'inline-flex', justifyContent: 'flex-end', margin: 0, padding: 0 }}
                                    >
                                      <span>Verify Tx</span>
                                      <ExternalLink size={12} />
                                    </a>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <div className="panel-foot" style={{ marginTop: '20px' }}>
                        <span>ZERO-EXTRA-CALL CALDATA PARSING</span>
                        <span className="mono">{approvals.length} RECORD(S)</span>
                      </div>
                    </section>
                  )}

                  {/* TAB 4: Wallet Linkability Score */}
                  {activeTab === 'linkability' && linkability && (
                    <section className="panel" style={{ padding: '24px' }}>
                      <div className="panel-heading" style={{ marginBottom: '16px' }}>
                        <div>
                          <div className="section-overline">CROSS-CHAIN CORRELATION</div>
                          <h2>Wallet Linkability Score</h2>
                        </div>
                        <span className="review-tag" data-testid="text-linkability-score">
                          {linkability.score} / 100 · {linkability.level}
                        </span>
                      </div>
                      <p className="risk-intro" style={{ maxWidth: '100%' }}>
                        Measures how easily this address can be clustered across networks based on active chain reuse ({linkability.activeChainCount}/{chains.length} chains) and shared cross-chain counterparties ({linkability.sharedCounterparties.length}).
                      </p>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px', marginTop: '16px' }}>
                        <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--primary))', marginBottom: '8px' }}>
                            <Link2 size={18} />
                            <strong>Multi-Chain Footprint</strong>
                          </div>
                          <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', margin: 0 }}>
                            Active across <strong>{linkability.activeChainCount}</strong> of {chains.length} inspected EVM networks.
                          </p>
                        </div>
                        <div style={{ padding: '16px', borderRadius: '8px', border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'hsl(var(--accent))', marginBottom: '8px' }}>
                            <Fingerprint size={18} />
                            <strong>Shared Counterparties</strong>
                          </div>
                          <p style={{ fontSize: '11px', color: 'hsl(var(--muted-foreground))', margin: 0 }}>
                            <strong>{linkability.sharedCounterparties.length}</strong> counterparty address(es) interacted with across 2+ chains.
                          </p>
                        </div>
                      </div>

                      {linkability.sharedCounterparties.length > 0 && (
                        <div style={{ marginTop: '20px' }}>
                          <span className="evidence-label" style={{ display: 'block', marginBottom: '8px' }}>
                            SHARED COUNTERPARTIES (VERIFY ON BLOCKSCOUT)
                          </span>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>COUNTERPARTY ADDRESS</th>
                                  <th>NETWORKS SEEN</th>
                                  <th>INTERACTIONS</th>
                                  <th style={{ textAlign: 'right' }}>EXPLORER</th>
                                </tr>
                              </thead>
                              <tbody>
                                {linkability.sharedCounterparties.map((item: any) => (
                                  <tr key={item.address}>
                                    <td className="mono">
                                      <button
                                        className="address-button"
                                        onClick={() => setIdentityAddress(item.address)}
                                      >
                                        {compactAddress(item.address)}
                                      </button>
                                    </td>
                                    <td>{item.chains.join(', ')}</td>
                                    <td className="mono">{item.txCount} txs</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <a
                                        href={item.explorerUrl || `https://eth.blockscout.com/address/${item.address}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="identity-link"
                                        style={{ display: 'inline-flex', justifyContent: 'flex-end', margin: 0, padding: 0 }}
                                      >
                                        <span>Blockscout</span>
                                        <ExternalLink size={12} />
                                      </a>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                      <div className="panel-foot" style={{ marginTop: '20px' }}>
                        <span>DETERMINISTIC CLUSTERING METRIC</span>
                        <span className="mono">{linkability.score}/100 SCORE</span>
                      </div>
                    </section>
                  )}

                  {/* TAB 5: Historical Performance Charts */}
                  {activeTab === 'history' && (
                    <section className="panel" style={{ padding: '24px' }}>
                      <div className="panel-heading" style={{ marginBottom: '16px' }}>
                        <div>
                          <div className="section-overline">PERFORMANCE & VOLUME</div>
                          <h2>Historical performance charts</h2>
                        </div>
                        <span className="review-tag">{lifetimeTxCount.toLocaleString()} LIFETIME TXS</span>
                      </div>
                      {history.length === 0 ? (
                        <div className="panel-empty" style={{ minHeight: '160px' }}>
                          <TrendingUp size={28} style={{ marginBottom: 8 }} />
                          <strong>No historical activity points</strong>
                          <span>No timestamped transactions were returned for this address.</span>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: '24px' }}>
                          <div style={{ height: 220 }}>
                            <div className="side-stat-label" style={{ marginBottom: 8 }}>
                              CUMULATIVE & DAILY VOLUME (USD)
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="date" fontSize={11} />
                                <YAxis fontSize={11} />
                                <ChartTooltip formatter={(value) => currency(Number(value))} />
                                <Area
                                  type="monotone"
                                  dataKey="volumeUsd"
                                  name="Daily Volume (USD)"
                                  stroke="#26776e"
                                  fill="#26776e"
                                  fillOpacity={0.25}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div style={{ height: 180 }}>
                            <div className="side-stat-label" style={{ marginBottom: 8 }}>
                              DAILY TRANSACTION FREQUENCY
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={history}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="date" fontSize={11} />
                                <YAxis fontSize={11} />
                                <ChartTooltip />
                                <Bar dataKey="txCount" name="Transactions" fill="#dc714d" radius={[3, 3, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                      <div className="panel-foot" style={{ marginTop: '20px' }}>
                        <span>LIFETIME ACTIVITY AGGREGATION</span>
                        <span className="mono">{history.length} ACTIVE DAY(S)</span>
                      </div>
                    </section>
                  )}
                </>
              )}
            </div>
          )}
          <footer className="page-footer">
            <span>
              <Sparkles size={13} /> A research instrument, not a security oracle.
            </span>
            <span>
              CHAINLENS <b>·</b> PUBLIC DATA ONLY
            </span>
          </footer>
        </div>
      </main>

      <Dialog
        open={Boolean(identityAddress)}
        onOpenChange={(open) => {
          if (!open) setIdentityAddress('');
        }}
      >
        <DialogContent
          className="identity-dialog"
          aria-labelledby="identity-title"
          data-testid="dialog-address-intelligence"
        >
          <div className="dialog-head">
            <div>
              <div className="section-overline">PUBLIC ADDRESS RECORD</div>
              <DialogTitle className="dialog-title" id="identity-title">
                Address intelligence
              </DialogTitle>
            </div>
            <DialogClose asChild>
              <button
                className="dialog-close"
                aria-label="Close address intelligence"
                data-testid="button-close-identity"
              >
                <X size={18} />
              </button>
            </DialogClose>
          </div>
          <div className="identity-mark">
            <Fingerprint size={27} strokeWidth={1.4} />
            <span>IDENTITY LAYER</span>
          </div>
          <div className="identity-address">
            <span className="mono" data-testid="text-identity-address">
              {compactAddress(identityAddress)}
            </span>
            <button
              onClick={copyAddress}
              className="copy-address"
              data-testid="button-copy-address"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy address'}
            </button>
            {identityAddress && (
              <a
                href={`https://eth.blockscout.com/address/${identityAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="copy-address"
                data-testid="link-dialog-blockscout"
              >
                <ExternalLink size={14} /> Blockscout
              </a>
            )}
          </div>
          {metadataQuery.isLoading ? (
            <div
              className="metadata-loading"
              data-testid="state-metadata-loading"
            >
              <div className="skeleton-block" />
              <div className="skeleton-block" />
              <span>LOOKING UP PUBLIC IDENTITY DATA</span>
            </div>
          ) : metadataQuery.isError ? (
            <div className="metadata-state" data-testid="state-metadata-error">
              <AlertCircle size={17} />
              <div>
                <strong>Metadata unavailable</strong>
                <span>The public identity lookup did not complete.</span>
              </div>
              <button
                onClick={() => metadataQuery.refetch()}
                data-testid="button-retry-metadata"
              >
                Retry
              </button>
            </div>
          ) : metadata && metadata.hasMetadata ? (
            <div className="metadata-results" data-testid="state-metadata-found">
              <div className="identity-profile">
                {metadata.iconUrl ? (
                  <img
                    src={metadata.iconUrl}
                    alt=""
                    className="profile-icon"
                    data-testid="img-address-icon"
                  />
                ) : (
                  <div className="profile-fallback">
                    <Fingerprint size={20} />
                  </div>
                )}
                <div>
                  <strong data-testid="text-address-name">
                    {metadata.name || metadata.ensName || 'Unnamed address'}
                  </strong>
                  <span>{metadata.ensName || 'Public address profile'}</span>
                </div>
              </div>
              {metadata.website && (
                <a
                  className="website-link"
                  href={
                    metadata.website.startsWith('http')
                      ? metadata.website
                      : `https://${metadata.website}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  data-testid="link-address-website"
                >
                  <Globe2 size={15} />
                  {metadata.website}
                  <ExternalLink size={13} />
                </a>
              )}
              <div className="tag-heading">
                PUBLIC TAGS <span className="mono">{metadata.tags.length}</span>
              </div>
              {metadata.tags.length ? (
                <div className="tag-list">
                  {metadata.tags.map((tag, index) => (
                    <span
                      key={`${tag}-${index}`}
                      data-testid={`tag-address-${index}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="no-tags">No public tags are listed.</div>
              )}
              <p className="metadata-footnote">
                Identity details are public metadata and may be incomplete or outdated.
              </p>
            </div>
          ) : (
            <div className="metadata-empty" data-testid="state-metadata-empty">
              <div className="empty-ring">
                <Fingerprint size={18} />
              </div>
              <strong>No public identity attached</strong>
              <span>
                No name, website, or tags were returned for this address.
              </span>
            </div>
          )}
          <div className="dialog-footer">
            <span>
              <span className="live-dot" /> METADATA SOURCE
            </span>
            <span>PUBLIC REGISTRY DATA</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotFound() {
  return (
    <div className="not-found">
      <div className="brand-mark">
        <span />
      </div>
      <div className="eyebrow">404 / NOT IN THIS FILE</div>
      <h1 className="display">No address here.</h1>
      <Link
        href="/dashboard"
        className="text-action"
        data-testid="link-return-dashboard"
      >
        Return to investigation <ArrowRight size={15} />
      </Link>
    </div>
  );
}

function Router() {
  return (
    <RouteErrorBoundary>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </RouteErrorBoundary>
  );
}

function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;