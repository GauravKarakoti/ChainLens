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
  Link2,
  LoaderCircle,
  Search,
  ShieldAlert,
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

const CHAIN_EXPLORERS: Record<string, string> = {
  '1': 'https://eth.blockscout.com',
  ethereum: 'https://eth.blockscout.com',
  '10': 'https://optimism.blockscout.com',
  optimism: 'https://optimism.blockscout.com',
  '42161': 'https://arbitrum.blockscout.com',
  arbitrum: 'https://arbitrum.blockscout.com',
  '8453': 'https://base.blockscout.com',
  base: 'https://base.blockscout.com',
  '137': 'https://polygon.blockscout.com',
  polygon: 'https://polygon.blockscout.com',
  '100': 'https://gnosis.blockscout.com',
  gnosis: 'https://gnosis.blockscout.com',
  '324': 'https://zksync.blockscout.com',
  'zksync era': 'https://zksync.blockscout.com',
  '534352': 'https://scroll.blockscout.com',
  scroll: 'https://scroll.blockscout.com',
  '59144': 'https://linea.blockscout.com',
  linea: 'https://linea.blockscout.com',
  '42220': 'https://celo.blockscout.com',
  celo: 'https://celo.blockscout.com',
};

const DEMO_WALLETS = [
  { label: 'vitalik.eth', address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' },
  { label: 'Multi-Chain DeFi', address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503' },
];

function blockscoutUrl(
  chainIdOrName: string | number,
  kind: 'tx' | 'address' | 'token',
  value: string,
): string {
  const key = String(chainIdOrName).toLowerCase();
  const base = CHAIN_EXPLORERS[key] ?? 'https://eth.blockscout.com';
  return `${base}/${kind}/${value}`;
}

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
const txIsZeroValue = (value: string) => {
  if (/^0x0*$/i.test(value)) return true;
  const n = Number(value);
  return Number.isFinite(n) && n === 0;
};
const lookalikeAddress = (candidate: string, other: string) => {
  const a = candidate.toLowerCase().replace(/^0x/, '');
  const b = other.toLowerCase().replace(/^0x/, '');
  if (a.length !== 40 || b.length !== 40 || a === b) return false;
  let prefix = 0;
  let suffix = 0;
  while (prefix < a.length && a[prefix] === b[prefix]) prefix += 1;
  while (suffix < a.length && a[a.length - suffix - 1] === b[b.length - suffix - 1]) suffix += 1;
  return (prefix >= 4 && suffix >= 4 && prefix + suffix >= 8) || prefix >= 6 || suffix >= 6;
};

function Dashboard() {
  const [draft, setDraft] = useState('');
  const [submittedAddress, setSubmittedAddress] = useState('');
  const [validationError, setValidationError] = useState('');
  const [identityAddress, setIdentityAddress] = useState('');
  const [copied, setCopied] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

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

  const overview = walletQuery.data as
    | (NonNullable<typeof walletQuery.data> & {
        totalLifetimeTransactions?: number;
        totalLifetimeTokenTransfers?: number;
      })
    | undefined;
  const chains = overview?.chains ?? [];

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
      chainId: number;
      native: boolean;
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
      });
      for (const token of chain.tokens ?? []) {
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
          (chain.transactions ?? []).map((tx) => ({
            ...tx,
            chain: chain.chainName,
            chainId: chain.chainId,
            priceUsd: chain.nativePriceUsd ?? 0,
          })),
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        ),
    [chains],
  );

  const lifetimeTxCount = useMemo(() => {
    if (typeof overview?.totalLifetimeTransactions === 'number' && overview.totalLifetimeTransactions > 0) {
      return overview.totalLifetimeTransactions;
    }
    return chains.reduce((acc, c) => {
      const extra = (c as { totalTransactionsCount?: number }).totalTransactionsCount;
      return acc + (typeof extra === 'number' ? extra : c.transactions?.length ?? 0);
    }, 0);
  }, [overview, chains]);

  const poisoningMatches = useMemo(() => {
    const historicalAddresses = [
      submittedAddress,
      ...transactions.flatMap((other) => [other.from, other.to ?? '']),
    ].filter(Boolean);

    return transactions.flatMap((tx) => {
      const candidates = [tx.from, tx.to ?? ''].filter(
        (addr) => addr && addr.toLowerCase() !== submittedAddress.toLowerCase(),
      );
      for (const candidate of candidates) {
        const mimicked = historicalAddresses.find(
          (other) =>
            other.toLowerCase() !== candidate.toLowerCase() &&
            lookalikeAddress(candidate, other),
        );
        if (mimicked && (txIsZeroValue(tx.value) || candidate.toLowerCase() === tx.from.toLowerCase())) {
          return [{ ...tx, suspiciousAddress: candidate, mimickedAddress: mimicked }];
        }
      }
      return [];
    });
  }, [transactions, submittedAddress]);

  const approvalTransactions = useMemo(
    () =>
      transactions
        .filter((tx) =>
          /approval event detected|approve|setApprovalForAll|increaseAllowance/i.test(
            tx.method ?? '',
          ),
        )
        .map((tx) => {
          const spenderMatch = (tx.method ?? '').match(/Spender (0x[a-fA-F0-9]{40})/);
          return {
            ...tx,
            spenderAddress: spenderMatch?.[1] ?? tx.to ?? tx.from,
            tokenAddress: tx.to ?? tx.from,
          };
        }),
    [transactions],
  );

  // Wallet Linkability Score (0-100) + Cross-Chain Shared Counterparties
  const linkability = useMemo(() => {
    const self = submittedAddress.toLowerCase();
    const activeChains = chains.filter(
      (c) =>
        numericValue(c.nativeBalance) > 0 ||
        (c.tokens?.length ?? 0) > 0 ||
        (c.transactions?.length ?? 0) > 0,
    );

    const counterpartyMap = new Map<string, { chains: Set<string>; txCount: number }>();
    const hourWindowMap = new Map<number, Set<string>>();

    for (const tx of transactions) {
      const from = tx.from.toLowerCase();
      const to = (tx.to ?? '').toLowerCase();
      const other = from === self ? to : from;
      if (/^0x[a-f0-9]{40}$/.test(other) && other !== self) {
        const current = counterpartyMap.get(other) ?? { chains: new Set<string>(), txCount: 0 };
        current.chains.add(tx.chain);
        current.txCount += 1;
        counterpartyMap.set(other, current);
      }
      const d = new Date(tx.timestamp);
      if (Number.isFinite(d.getTime())) {
        const h = d.getUTCHours();
        const set = hourWindowMap.get(h) ?? new Set<string>();
        set.add(tx.chain);
        hourWindowMap.set(h, set);
      }
    }

    const sharedCounterparties = Array.from(counterpartyMap.entries())
      .filter(([, info]) => info.chains.size >= 2)
      .map(([address, info]) => ({
        address,
        chains: Array.from(info.chains),
        txCount: info.txCount,
      }))
      .sort((a, b) => b.chains.length - a.chains.length || b.txCount - a.txCount);

    const overlappingHours = Array.from(hourWindowMap.values()).filter((s) => s.size >= 2).length;
    const score = Math.min(
      100,
      Math.min(40, activeChains.length * 5) +
        Math.min(40, sharedCounterparties.length * 12) +
        Math.min(20, overlappingHours * 4),
    );
    const level =
      score >= 75 ? 'CRITICAL' : score >= 50 ? 'HIGH' : score >= 25 ? 'MODERATE' : 'LOW';

    return {
      score,
      level,
      activeChainCount: activeChains.length,
      sharedCounterparties,
      overlappingHours,
    };
  }, [chains, transactions, submittedAddress]);

  // Historical Performance & Complete Activity Chart Series
  const historicalSeries = useMemo(() => {
    const byDate = new Map<
      string,
      { date: string; txCount: number; volumeUsd: number; chains: Set<string> }
    >();
    for (const tx of transactions) {
      const d = new Date(tx.timestamp);
      if (!Number.isFinite(d.getTime())) continue;
      const date = d.toISOString().slice(0, 10);
      const entry = byDate.get(date) ?? {
        date,
        txCount: 0,
        volumeUsd: 0,
        chains: new Set<string>(),
      };
      entry.txCount += 1;
      entry.chains.add(tx.chain);
      const rawAmount = numericValue(tx.value);
      const normalizedEth = rawAmount > 1e9 ? rawAmount / 1e18 : rawAmount;
      entry.volumeUsd += normalizedEth * (tx.priceUsd || 0);
      byDate.set(date, entry);
    }
    const sorted = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
    let cumulativeUsd = 0;
    return sorted.map((item) => {
      cumulativeUsd += item.volumeUsd;
      return {
        date: item.date,
        txCount: item.txCount,
        volumeUsd: Number(item.volumeUsd.toFixed(2)),
        cumulativeUsd: Number(cumulativeUsd.toFixed(2)),
        activeChains: item.chains.size,
      };
    });
  }, [transactions]);

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
            <b>Wallet overview (10+ Chains)</b>
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
                <span className="eyebrow-line" /> MULTICHAIN INVESTIGATION (10+ NETWORKS)
              </div>
              <h1 className="display">
                Wallet <em>overview</em>
              </h1>
              <p className="heading-copy">
                Cross-chain holdings, Wallet Linkability Score, historical performance charts, and Blockscout-verified risk signals across 10+ EVM chains.
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
                  Enter a public wallet address to assemble its cross-chain holdings across 10+ networks, Wallet Linkability Score, historical performance charts, and Blockscout-verifiable security signals.
                </p>
                <div className="welcome-details">
                  <span>
                    <span className="detail-index">01</span> 10+ CHAIN SNAPSHOT
                  </span>
                  <span>
                    <span className="detail-index">02</span> LINKABILITY & CHARTS
                  </span>
                  <span>
                    <span className="detail-index">03</span> BLOCKSCOUT VERIFICATION
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
                          href={blockscoutUrl(1, 'address', submittedAddress)}
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
                        {chains.map((chain) => (
                          <a
                            href={blockscoutUrl(chain.chainId, 'address', submittedAddress)}
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
                          {lifetimeTxCount.toLocaleString()} lifetime transactions ·{' '}
                          {transactions.length} recent records analyzed
                        </span>
                      </div>
                      {hasPartialChains && (
                        <div className="partial-note" data-testid="notice-partial-chain">
                          <AlertCircle size={13} /> Some native balances, token rows, or prices are unavailable; estimates may be incomplete.
                        </div>
                      )}
                    </div>
                  </section>

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
                            aria-label="Pie chart showing token allocation by returned value"
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
                                        data-testid={`slice-allocation-${asset.key}`}
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
                                    <TableRow
                                      className="chain-group-row"
                                      data-testid={`group-chain-${chain.chainId}`}
                                    >
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
                                      <TableRow
                                        className="asset-row"
                                        key={asset.key}
                                        data-testid={`row-asset-${asset.key}`}
                                      >
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
                                                  data-testid={`img-token-${asset.key}`}
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
                                                  data-testid={`button-token-address-${asset.key}`}
                                                >
                                                  {compactAddress(asset.address)}
                                                </button>
                                                <a
                                                  href={blockscoutUrl(
                                                    asset.chainId,
                                                    asset.native ? 'address' : 'token',
                                                    asset.address,
                                                  )}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  className="address-button"
                                                  title="Verify on Blockscout Explorer"
                                                  data-testid={`link-explorer-asset-${asset.key}`}
                                                >
                                                  <ExternalLink size={12} />
                                                </a>
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
                                        <TableCell
                                          className="asset-value mono"
                                          data-testid={`text-value-${asset.key}`}
                                        >
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

                    <section className="panel risk-panel">
                      <div className="panel-heading">
                        <div>
                          <div className="section-overline">02 / REVIEW NOTES</div>
                          <h2>Risk signals & Blockscout verification</h2>
                        </div>
                        <span className="review-tag">VERIFIABLE ON-CHAIN</span>
                      </div>
                      <p className="risk-intro">
                        Signals below are derived from transactions returned for this address. Click any address or transaction hash to verify directly on Blockscout Explorer.
                      </p>
                      <div className="risk-items">
                        <div
                          className={`risk-item ${
                            poisoningMatches.length ? 'risk-attention' : ''
                          }`}
                          data-testid="signal-zero-value-lookalike"
                        >
                          <div className="risk-symbol">
                            {poisoningMatches.length ? (
                              <ShieldAlert size={17} />
                            ) : (
                              <ShieldCheck size={17} />
                            )}
                          </div>
                          <div className="risk-copy">
                            <strong>Address poisoning & lookalike activity</strong>
                            <span>
                              {poisoningMatches.length
                                ? `${poisoningMatches.length} lookalike / zero-value transaction${
                                    poisoningMatches.length === 1 ? '' : 's'
                                  } found`
                                : 'No matching evidence in returned transactions'}
                            </span>
                          </div>
                          <span
                            className={`risk-status ${
                              poisoningMatches.length ? 'attention' : ''
                            }`}
                          >
                            {poisoningMatches.length ? 'REVIEW' : 'CLEAR'}
                          </span>
                        </div>
                        <div
                          className={`risk-item ${
                            approvalTransactions.length ? 'risk-attention' : ''
                          }`}
                          data-testid="signal-approval-evidence"
                        >
                          <div className="risk-symbol">
                            {approvalTransactions.length ? (
                              <ShieldAlert size={17} />
                            ) : (
                              <ShieldCheck size={17} />
                            )}
                          </div>
                          <div className="risk-copy">
                            <strong>Token approval evidence</strong>
                            <span>
                              {approvalTransactions.length
                                ? `${approvalTransactions.length} approval transaction${
                                    approvalTransactions.length === 1 ? '' : 's'
                                  } found`
                                : 'No approvals found in recent candidate transactions'}
                            </span>
                          </div>
                          <span
                            className={`risk-status ${
                              approvalTransactions.length ? 'attention' : ''
                            }`}
                          >
                            {approvalTransactions.length ? 'REVIEW' : 'CLEAR'}
                          </span>
                        </div>
                      </div>
                      <div className="risk-foot">
                        <CircleHelp size={14} />
                        <span>
                          Every finding links directly to Blockscout Explorer for independent verification.
                        </span>
                      </div>
                      {poisoningMatches.length > 0 && (
                        <div
                          className="evidence-list"
                          data-testid="list-lookalike-evidence"
                        >
                          <span className="evidence-label">
                            POISONING & LOOKALIKE EVIDENCE (VERIFY ON BLOCKSCOUT)
                          </span>
                          {poisoningMatches.slice(0, 5).map((tx) => (
                            <div
                              key={`${tx.chain}-${tx.hash}`}
                              className="evidence-row"
                            >
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                <button
                                  className="address-button mono"
                                  onClick={() =>
                                    setIdentityAddress(tx.suspiciousAddress)
                                  }
                                  data-testid={`button-suspicious-address-${tx.hash}`}
                                >
                                  {compactAddress(tx.suspiciousAddress)}
                                </button>
                                <a
                                  href={blockscoutUrl(
                                    tx.chainId,
                                    'address',
                                    tx.suspiciousAddress,
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="address-button"
                                  title="Open suspicious address in Blockscout Explorer"
                                  data-testid={`link-explorer-poison-address-${tx.hash}`}
                                >
                                  <ExternalLink size={12} />
                                </a>
                              </span>
                              <span>{tx.chain}</span>
                              <a
                                href={blockscoutUrl(tx.chainId, 'tx', tx.hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="address-button mono"
                                title="Verify poisoning transaction in Blockscout Explorer"
                                data-testid={`link-explorer-poison-tx-${tx.hash}`}
                              >
                                {compactAddress(tx.hash)} <ExternalLink size={12} />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                      {approvalTransactions.length > 0 && (
                        <div
                          className="evidence-list"
                          data-testid="list-approval-evidence"
                        >
                          <span className="evidence-label">
                            APPROVAL TRANSACTIONS & SPENDERS (VERIFY ON BLOCKSCOUT)
                          </span>
                          {approvalTransactions.slice(0, 5).map((tx) => (
                            <div
                              key={`${tx.chain}-${tx.hash}`}
                              className="evidence-row"
                            >
                              <span>{tx.method}</span>
                              <span>
                                <a
                                  href={blockscoutUrl(
                                    tx.chainId,
                                    'address',
                                    tx.spenderAddress,
                                  )}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="address-button mono"
                                  title="Inspect spender contract on Blockscout"
                                  data-testid={`link-explorer-approval-spender-${tx.hash}`}
                                >
                                  Spender {compactAddress(tx.spenderAddress)}{' '}
                                  <ExternalLink size={12} />
                                </a>
                              </span>
                              <a
                                href={blockscoutUrl(tx.chainId, 'tx', tx.hash)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="address-button mono"
                                title="Verify approval transaction on Blockscout"
                                data-testid={`link-explorer-approval-tx-${tx.hash}`}
                              >
                                {compactAddress(tx.hash)} <ExternalLink size={12} />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  {/* NEW SECTION: Wallet Linkability Score & Historical Performance Charts */}
                  <div className="content-grid reveal reveal-delay-1">
                    <section
                      className="panel"
                      data-testid="section-wallet-linkability"
                    >
                      <div className="panel-heading">
                        <div>
                          <div className="section-overline">
                            03 / CROSS-CHAIN CORRELATION
                          </div>
                          <h2>Wallet Linkability Score</h2>
                        </div>
                        <span className="review-tag" data-testid="text-linkability-score">
                          {linkability.score} / 100 · {linkability.level}
                        </span>
                      </div>
                      <p className="risk-intro">
                        Measures how easily this address can be clustered across networks based on active chain reuse ({linkability.activeChainCount}/{chains.length} chains), shared cross-chain counterparties ({linkability.sharedCounterparties.length}), and overlapping UTC activity windows ({linkability.overlappingHours}).
                      </p>
                      <div className="risk-items">
                        <div className="risk-item">
                          <div className="risk-symbol">
                            <Link2 size={17} />
                          </div>
                          <div className="risk-copy">
                            <strong>Multi-Chain Address Footprint</strong>
                            <span>
                              Active on {linkability.activeChainCount} of {chains.length} inspected EVM networks
                            </span>
                          </div>
                          <span className="risk-status">
                            {linkability.score}/100
                          </span>
                        </div>
                        <div className="risk-item">
                          <div className="risk-symbol">
                            <Fingerprint size={17} />
                          </div>
                          <div className="risk-copy">
                            <strong>Shared Cross-Chain Counterparties</strong>
                            <span>
                              {linkability.sharedCounterparties.length
                                ? `${linkability.sharedCounterparties.length} address(es) interacted with across 2+ networks`
                                : 'No repeated counterparties across multiple networks'}
                            </span>
                          </div>
                          <span className="risk-status">
                            {linkability.sharedCounterparties.length} SHARED
                          </span>
                        </div>
                      </div>
                      {linkability.sharedCounterparties.length > 0 && (
                        <div
                          className="evidence-list"
                          data-testid="list-shared-counterparties"
                        >
                          <span className="evidence-label">
                            CROSS-CHAIN COUNTERPARTIES (VERIFY ON BLOCKSCOUT)
                          </span>
                          {linkability.sharedCounterparties.slice(0, 4).map((item) => (
                            <div key={item.address} className="evidence-row">
                              <button
                                className="address-button mono"
                                onClick={() => setIdentityAddress(item.address)}
                              >
                                {compactAddress(item.address)}
                              </button>
                              <span>{item.chains.join(', ')}</span>
                              <a
                                href={blockscoutUrl(
                                  item.chains[0],
                                  'address',
                                  item.address,
                                )}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="address-button mono"
                              >
                                Blockscout <ExternalLink size={12} />
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section
                      className="panel"
                      data-testid="section-historical-charts"
                    >
                      <div className="panel-heading">
                        <div>
                          <div className="section-overline">
                            04 / HISTORICAL PERFORMANCE & ACTIVITY
                          </div>
                          <h2>Historical performance charts</h2>
                        </div>
                        <span className="review-tag">
                          {lifetimeTxCount.toLocaleString()} LIFETIME TXS
                        </span>
                      </div>
                      {historicalSeries.length === 0 ? (
                        <div className="panel-empty">
                          <div className="empty-ring">
                            <TrendingUp size={17} />
                          </div>
                          <strong>No historical activity points</strong>
                          <span>
                            No timestamped transactions were returned for this address.
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: '16px', padding: '8px 0' }}>
                          <div style={{ height: 160 }}>
                            <div className="side-stat-label" style={{ marginBottom: 6 }}>
                              CUMULATIVE & DAILY TRANSACTION VOLUME (USD)
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={historicalSeries}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="date" fontSize={11} />
                                <YAxis fontSize={11} />
                                <ChartTooltip
                                  formatter={(value) => currency(Number(value))}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="cumulativeUsd"
                                  name="Cumulative Volume"
                                  stroke="#26776e"
                                  fill="#26776e"
                                  fillOpacity={0.22}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div style={{ height: 140 }}>
                            <div className="side-stat-label" style={{ marginBottom: 6 }}>
                              MULTICHAIN TRANSACTION FREQUENCY BY DATE
                            </div>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={historicalSeries}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                <XAxis dataKey="date" fontSize={11} />
                                <YAxis fontSize={11} />
                                <ChartTooltip />
                                <Bar
                                  dataKey="txCount"
                                  name="Transactions"
                                  fill="#dc714d"
                                  radius={[3, 3, 0, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )}
                      <div className="panel-foot">
                        <span>
                           LIFETIME TOTAL: {lifetimeTxCount.toLocaleString()} TXS ACROSS {chains.length} NETWORKS
                        </span>
                        <span className="mono">
                          {historicalSeries.length} ACTIVE DAY{historicalSeries.length === 1 ? '' : 'S'}
                        </span>
                      </div>
                    </section>
                  </div>

                  <section className="panel transactions-panel reveal reveal-delay-2">
                    <div className="panel-heading transaction-heading">
                      <div>
                        <div className="section-overline">05 / RECENT ACTIVITY</div>
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
                      <div
                        className="transaction-empty"
                        data-testid="empty-transactions"
                      >
                        <Activity size={18} />
                        <span>
                          No recent transactions were returned for these networks.
                        </span>
                      </div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>TRANSACTION (BLOCKSCOUT)</th>
                              <th>NETWORK</th>
                              <th>METHOD</th>
                              <th>COUNTERPARTY (BLOCKSCOUT)</th>
                              <th>VALUE</th>
                              <th>STATUS</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.slice(0, 15).map((tx, index) => {
                              const outgoing =
                                tx.from.toLowerCase() ===
                                submittedAddress.toLowerCase();
                              const counterpart = outgoing ? tx.to : tx.from;
                              return (
                                <tr
                                  key={`${tx.chain}-${tx.hash}-${index}`}
                                  data-testid={`row-transaction-${tx.hash}`}
                                >
                                  <td>
                                    <span className="tx-direction">
                                      {outgoing ? (
                                        <ArrowUpRight size={14} />
                                      ) : (
                                        <ArrowDownLeft size={14} />
                                      )}
                                    </span>
                                    <a
                                      href={blockscoutUrl(
                                        tx.chainId,
                                        'tx',
                                        tx.hash,
                                      )}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mono tx-hash address-button"
                                      data-testid={`link-explorer-tx-${tx.hash}`}
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
                                          data-testid={`button-counterparty-${tx.hash}`}
                                        >
                                          {compactAddress(counterpart)}
                                        </button>
                                        <a
                                          href={blockscoutUrl(
                                            tx.chainId,
                                            'address',
                                            counterpart,
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="address-button"
                                          title="Open counterparty in Blockscout Explorer"
                                          data-testid={`link-explorer-counterparty-${tx.hash}`}
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
                                        tx.status.toLowerCase() === 'success' ||
                                        tx.status.toLowerCase() === 'ok'
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
                        LIFETIME HISTORY: {lifetimeTxCount.toLocaleString()} TXS · RECENT SAMPLE ANALYZED
                      </span>
                      <span className="mono">
                        {transactions.length > 15 ? 'SHOWING 15 OF ' : 'SHOWING '}
                        {transactions.length}
                      </span>
                    </div>
                  </section>
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
                href={blockscoutUrl(1, 'address', identityAddress)}
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