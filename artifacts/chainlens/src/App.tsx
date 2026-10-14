import { Fragment, type CSSProperties, type FormEvent, type ReactNode, useMemo, useState } from 'react';
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
} from '@workspace/api-client-react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
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
  LoaderCircle,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { Link, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

const validAddress = (address: string) => /^0x[a-fA-F0-9]{40}$/.test(address.trim());
const compactAddress = (address: string) => `${address.slice(0, 7)}…${address.slice(-5)}`;
const numericValue = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const currency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value > 1000 ? 0 : 2 }).format(value);
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
  return prefix >= 5 && suffix >= 5;
};

function Dashboard() {
  const [draft, setDraft] = useState('');
  const [submittedAddress, setSubmittedAddress] = useState('');
  const [validationError, setValidationError] = useState('');
  const [identityAddress, setIdentityAddress] = useState('');
  const [copied, setCopied] = useState(false);
  const blockscout = useGetBlockscoutStatus({
    query: { queryKey: getGetBlockscoutStatusQueryKey(), retry: 1 },
  });
  const walletQuery = useGetWalletOverview(submittedAddress, {
    query: {
      queryKey: getGetWalletOverviewQueryKey(submittedAddress),
      enabled: validAddress(submittedAddress) && blockscout.data?.configured === true,
      retry: 1,
    },
  });
  const metadataQuery = useGetAddressMetadata(identityAddress, {
    query: {
      queryKey: getGetAddressMetadataQueryKey(identityAddress),
      enabled: Boolean(identityAddress),
      retry: 1,
    },
  });
  const overview = walletQuery.data;
  const chains = overview?.chains ?? [];
  const holdings = useMemo(() => {
    const assets: { key: string; address: string; name: string; symbol: string; amount: string; value: number | null; iconUrl: string | null; chain: string; native: boolean }[] = [];
    for (const chain of chains) {
      const nativeAmount = numericValue(chain.nativeBalance);
      const nativePrice = chain.nativePriceUsd;
      assets.push({
        key: `native-${chain.chainId}`,
        address: submittedAddress,
        name: chain.chainName,
        symbol: chain.nativeSymbol,
        amount: chain.nativeBalance,
        value: nativePrice === null ? null : nativeAmount * nativePrice,
        iconUrl: null,
        chain: chain.chainName,
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
          native: false,
        });
      }
    }
    return assets;
  }, [chains, submittedAddress]);
  const totalValue = holdings.reduce((total, item) => total + (item.value ?? 0), 0);
  const valuedAssets = holdings.filter((item) => item.value !== null && item.value > 0);
  const allocationColors = ['#26776e', '#dc714d', '#718a96', '#d4a545', '#8a789f', '#4b9990'];
  const transactions = chains.flatMap((chain) => (chain.transactions ?? []).map((tx) => ({ ...tx, chain: chain.chainName })));
  const poisoningMatches = transactions.flatMap((tx) => {
    if (!txIsZeroValue(tx.value)) return [];
    const historicalAddresses = transactions
      .filter((other) => other.hash !== tx.hash || other.chain !== tx.chain)
      .flatMap((other) => [other.from, other.to ?? ''])
      .filter(Boolean);
    const suspiciousAddress = [tx.from, tx.to ?? ''].find(
      (candidate) =>
        candidate &&
        historicalAddresses.some((other) => lookalikeAddress(candidate, other)),
    );
    return suspiciousAddress ? [{ ...tx, suspiciousAddress }] : [];
  });
  const approvalTransactions = transactions.filter((tx) =>
    /approval event detected|approve|setApprovalForAll/i.test(tx.method ?? ''),
  );
  const hasPartialChains =
    chains.some((chain) => chain.nativePriceUsd === null || chain.tokenBalancesIncomplete) ||
    holdings.some((asset) => asset.value === null);
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
    setSubmittedAddress(value);
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
        <Link href="/dashboard" className="brand-lockup" data-testid="link-brand-dashboard">
          <span className="brand-mark"><span /></span>
          <span className="brand-word">chain<span>lens</span></span>
        </Link>
        <div className="side-rule" />
        <div className="side-caption">WORKSPACE</div>
        <Link href="/dashboard" className="nav-item nav-active" data-testid="link-nav-investigate">
          <Fingerprint size={17} strokeWidth={1.8} />
          <span>Investigate</span>
          <span className="nav-indicator" />
        </Link>
        <div className="sidebar-bottom">
          <div className="instrument-card">
            <div className="instrument-top"><span className="live-dot" /> DATA SOURCE</div>
            {blockscout.isLoading ? (
              <div className="source-message" data-testid="status-blockscout-loading">Checking connection…</div>
            ) : blockscout.isError ? (
              <button className="source-error" onClick={() => blockscout.refetch()} data-testid="button-retry-blockscout">
                <AlertCircle size={14} /> Connection status unavailable · retry
              </button>
            ) : blockscout.data?.configured ? (
              <div className="source-message" data-testid="status-blockscout-configured">API key configured</div>
            ) : (
              <div className="source-message source-warning" data-testid="status-blockscout-unconfigured">API Key is not set</div>
            )}
            <p>Read-only · public chain data</p>
          </div>
          <div className="side-foot"><span>CHAINLENS</span><span>v1.0 / FIELD NOTES</span></div>
        </div>
      </aside>

      <main className="main-area shell-grid">
        <header className="topbar">
          <div className="crumb"><span>RESEARCH</span><span className="crumb-slash">/</span><b>Wallet overview</b></div>
          <div className="topbar-right"><span className="secure-label"><span className="live-dot" /> READ-ONLY SESSION</span><span className="avatar-monogram">CL</span></div>
        </header>
        <div className="page-content">
          <div className="page-heading reveal">
            <div>
              <div className="eyebrow"><span className="eyebrow-line" /> MULTICHAIN INVESTIGATION</div>
              <h1 className="display">Wallet <em>overview</em></h1>
              <p className="heading-copy">A clear view of holdings, activity, and public identity.</p>
            </div>
            <div className="workspace-stamp"><span>CASE FILE</span><strong>CL—01</strong><span>PUBLIC ADDRESS INTELLIGENCE</span></div>
          </div>

          <section className="search-panel reveal reveal-delay-1" aria-label="Wallet address search">
            <div className="search-label-row"><label htmlFor="wallet-search">ADDRESS TO INVESTIGATE</label><span className="search-hint"><CircleHelp size={13} /> EVM-compatible address</span></div>
            <form className="search-form" onSubmit={submitSearch}>
              <Search size={19} className="search-icon" />
              <input
                id="wallet-search"
                value={draft}
                onChange={(event) => { setDraft(event.target.value); setValidationError(''); }}
                placeholder="Paste wallet address  ·  0x…"
                autoComplete="off"
                spellCheck={false}
                data-testid="input-wallet-address"
              />
              <button type="submit" className="search-submit" data-testid="button-search-wallet">
                Investigate <ArrowRight size={16} />
              </button>
            </form>
            {validationError && <div className="validation-note" role="alert" data-testid="error-address-validation"><AlertCircle size={14} />{validationError}</div>}
            <div className="search-foot"><span>Search across supported networks</span><span className="mono">ADDRESS INPUT IS NEVER STORED</span></div>
          </section>

          {!submittedAddress && blockscout.data?.configured !== false && (
            <section className="welcome-state reveal reveal-delay-2" data-testid="empty-investigation">
              <div className="welcome-graphic" aria-hidden="true">
                <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
                <div className="orbit-core"><Fingerprint size={37} strokeWidth={1.25} /></div>
                <span className="orbit-point point-a" /><span className="orbit-point point-b" /><span className="orbit-point point-c" />
              </div>
              <div className="welcome-copy">
                <div className="eyebrow"><span className="eyebrow-line" /> READY WHEN YOU ARE</div>
                <h2>Start with an address.<br /><em>Follow the evidence.</em></h2>
                <p>Enter a public wallet address to assemble its cross-chain holdings, recent activity, and available identity signals.</p>
                <div className="welcome-details"><span><span className="detail-index">01</span> BALANCE SNAPSHOT</span><span><span className="detail-index">02</span> ACTIVITY REVIEW</span><span><span className="detail-index">03</span> PUBLIC IDENTITY</span></div>
              </div>
              <div className="empty-index mono">NO ACTIVE<br />INVESTIGATION</div>
            </section>
          )}

          {blockscout.data?.configured === false && !blockscout.isLoading && (
            <section className="notice-panel notice-warning" data-testid="state-unconfigured-key">
              <div className="notice-icon"><AlertCircle size={20} /></div><div><h2>API Key is not set</h2><p>ChainLens needs a Blockscout PRO API key to retrieve live wallet balances, activity, and address metadata. No sample wallet data is shown.</p></div>
            </section>
          )}

          {submittedAddress && blockscout.isError && (
            <section className="notice-panel notice-warning" data-testid="state-status-error">
              <div className="notice-icon"><AlertCircle size={20} /></div><div><h2>Could not verify the data source</h2><p>Wallet retrieval is paused until the Blockscout connection status can be confirmed.</p><button className="text-action" onClick={() => blockscout.refetch()} data-testid="button-retry-status">Try connection again <ArrowRight size={14} /></button></div>
            </section>
          )}

          {submittedAddress && blockscout.data?.configured && walletQuery.isLoading && (
            <section className="loading-dashboard" aria-label="Loading wallet overview" data-testid="state-wallet-loading">
              <div className="skeleton-block skeleton-total" /><div className="skeleton-row"><div className="skeleton-block" /><div className="skeleton-block" /></div><div className="skeleton-block skeleton-table" />
              <span className="loading-caption"><LoaderCircle size={14} /> COLLECTING PUBLIC CHAIN RECORDS</span>
            </section>
          )}

          {submittedAddress && blockscout.data?.configured && walletQuery.isError && (
            <section className="notice-panel notice-error" data-testid="state-wallet-error">
              <div className="notice-icon"><AlertCircle size={20} /></div><div><h2>Couldn’t retrieve this wallet</h2><p>{queryError?.message || 'The data source did not return an overview for this address.'} Check the address or try the request again.</p><button className="text-action" onClick={() => walletQuery.refetch()} data-testid="button-retry-wallet">Retry investigation <ArrowRight size={14} /></button></div>
            </section>
          )}

          {submittedAddress && walletQuery.isSuccess && (
            <div className="results-stack">
              {chains.length === 0 ? (
                <section className="notice-panel" data-testid="state-empty-wallet">
                  <div className="notice-icon"><Search size={19} /></div><div><h2>No supported chain records</h2><p>The source returned a wallet overview, but no supported chains or balances were found for this address.</p></div>
                </section>
              ) : (
                <>
                  <section className="summary-grid reveal" data-testid="section-wallet-summary">
                    <div className="summary-main">
                      <div className="summary-kicker"><span className="eyebrow-line" /> ESTIMATED PORTFOLIO VALUE <span className="quiet-badge">LIVE DATA</span></div>
                      <div className="total-value" data-testid="text-portfolio-total">{currency(totalValue)}<span className="estimate-mark">~</span></div>
                      <div className="summary-meta"><span><span className="summary-dot" /> {chains.length} {chains.length === 1 ? 'network' : 'networks'} scanned</span><span>{valuedAssets.length} valued {valuedAssets.length === 1 ? 'asset' : 'assets'}</span></div>
                      <div className="wallet-line">
                        <span className="wallet-avatar"><Fingerprint size={19} /></span>
                         <button className="wallet-address mono address-button" onClick={openIdentity} data-testid="text-wallet-address">{compactAddress(submittedAddress)}</button>
                        <button className="identity-link" onClick={openIdentity} data-testid="button-open-identity"><span>Address intelligence</span><ArrowRight size={14} /></button>
                      </div>
                    </div>
                    <div className="summary-side">
                      <div className="side-stat-label">NETWORK COVERAGE</div>
                      <div className="chain-badges">{chains.map((chain) => <span className="chain-pill" key={chain.chainId} data-testid={`badge-chain-${chain.chainId}`}><span className="chain-mark">{chain.nativeSymbol.slice(0, 1)}</span>{chain.chainName}</span>)}</div>
                      <div className="coverage-note"><Activity size={14} /><span>{transactions.length} recent transactions returned</span></div>
                       {hasPartialChains && <div className="partial-note" data-testid="notice-partial-chain"><AlertCircle size={13} /> Some token rows or prices are unavailable; estimates may be incomplete.</div>}
                    </div>
                  </section>

                  <div className="content-grid reveal reveal-delay-1">
                    <section className="panel holdings-panel">
                      <div className="panel-heading">
                        <div><div className="section-overline">01 / PORTFOLIO</div><h2>Asset allocation</h2></div>
                        <button className="panel-menu" onClick={() => document.getElementById('asset-list')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })} aria-label="Jump to asset list" data-testid="button-jump-assets"><ChevronDown size={16} /></button>
                      </div>
                      {valuedAssets.length === 0 ? (
                        <div className="panel-empty" data-testid="empty-portfolio"><div className="empty-ring"><Activity size={17} /></div><strong>No priced assets returned</strong><span>Balances are present, but current price data is unavailable.</span></div>
                      ) : (
                        <>
                          <div className="allocation-visual" data-testid="chart-token-allocation" aria-label="Pie chart showing token allocation by returned value">
                            <div className="allocation-chart">
                              <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                  <Pie data={valuedAssets} dataKey="value" nameKey="symbol" innerRadius="63%" outerRadius="83%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                                    {valuedAssets.map((asset, index) => <Cell key={asset.key} fill={allocationColors[index % allocationColors.length]} data-testid={`slice-allocation-${asset.key}`} />)}
                                  </Pie>
                                  <ChartTooltip formatter={(value) => currency(Number(value))} />
                                </PieChart>
                              </ResponsiveContainer>
                              <div className="allocation-center"><span>EST. VALUE</span><strong>{currency(totalValue)}</strong></div>
                            </div>
                            <div className="allocation-legend">{valuedAssets.slice(0, 5).map((asset, index) => <span key={asset.key}><i style={{ background: allocationColors[index % allocationColors.length] }} />{asset.symbol}</span>)}{valuedAssets.length > 5 && <span>+{valuedAssets.length - 5} more</span>}</div>
                          </div>
                          <div className="asset-list" id="asset-list">
                            <Table className="asset-table">
                              <TableHeader>
                                <TableRow><TableHead>Asset</TableHead><TableHead>Balance</TableHead><TableHead>Value</TableHead></TableRow>
                              </TableHeader>
                              <TableBody>
                                {holdingsByChain.map(({ chain, assets }) => (
                                  <Fragment key={chain.chainId}>
                                    <TableRow className="chain-group-row" data-testid={`group-chain-${chain.chainId}`}>
                                      <TableCell colSpan={3}><span className="chain-mark">{chain.nativeSymbol.slice(0, 1)}</span>{chain.chainName}<span className="chain-asset-count">{assets.length} position{assets.length === 1 ? '' : 's'}</span></TableCell>
                                    </TableRow>
                                    {assets.map((asset, index) => (
                                      <TableRow className="asset-row" key={asset.key} data-testid={`row-asset-${asset.key}`}>
                                        <TableCell>
                                          <div className="asset-cell">
                                            <div className="asset-icon" style={{ '--asset-color': allocationColors[index % allocationColors.length] } as CSSProperties}>
                                              {asset.iconUrl ? <img src={asset.iconUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} data-testid={`img-token-${asset.key}`} /> : <span>{asset.symbol.slice(0, 1)}</span>}
                                            </div>
                                            <div className="asset-name"><strong>{asset.name}</strong><button className="address-button asset-address" onClick={() => setIdentityAddress(asset.address)} data-testid={`button-token-address-${asset.key}`}>{compactAddress(asset.address)}</button></div>
                                          </div>
                                        </TableCell>
                                        <TableCell className="asset-amount mono">{quantity(asset.amount)} <span>{asset.symbol}</span></TableCell>
                                        <TableCell className="asset-value mono" data-testid={`text-value-${asset.key}`}>{asset.value === null ? '—' : currency(asset.value)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </Fragment>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </>
                      )}
                      <div className="panel-foot"><span>VALUES AS RETURNED BY SOURCE</span><span className="mono">{holdings.length} POSITION{holdings.length === 1 ? '' : 'S'}</span></div>
                    </section>

                    <section className="panel risk-panel">
                      <div className="panel-heading">
                        <div><div className="section-overline">02 / REVIEW NOTES</div><h2>Risk signals</h2></div>
                        <span className="review-tag">NOT A VERDICT</span>
                      </div>
                      <p className="risk-intro">Signals below are derived only from transactions returned for this address. They are prompts for analyst review, not security conclusions.</p>
                      <div className="risk-items">
                        <div className={`risk-item ${poisoningMatches.length ? 'risk-attention' : ''}`} data-testid="signal-zero-value-lookalike">
                          <div className="risk-symbol">{poisoningMatches.length ? <ShieldAlert size={17} /> : <ShieldCheck size={17} />}</div>
                          <div className="risk-copy"><strong>Zero-value lookalike activity</strong><span>{poisoningMatches.length ? `${poisoningMatches.length} matching zero-value transaction${poisoningMatches.length === 1 ? '' : 's'} found` : 'No matching evidence in returned transactions'}</span></div>
                          <span className={`risk-status ${poisoningMatches.length ? 'attention' : ''}`}>{poisoningMatches.length ? 'REVIEW' : 'CLEAR'}</span>
                        </div>
                        <div className={`risk-item ${approvalTransactions.length ? 'risk-attention' : ''}`} data-testid="signal-approval-evidence">
                          <div className="risk-symbol">{approvalTransactions.length ? <ShieldAlert size={17} /> : <ShieldCheck size={17} />}</div>
                          <div className="risk-copy"><strong>Token approval log evidence</strong><span>{approvalTransactions.length ? `${approvalTransactions.length} recent approval log${approvalTransactions.length === 1 ? '' : 's'} found` : 'No approval logs found in recent candidate transactions'}</span></div>
                          <span className={`risk-status ${approvalTransactions.length ? 'attention' : ''}`}>{approvalTransactions.length ? 'REVIEW' : 'CLEAR'}</span>
                        </div>
                      </div>
                      <div className="risk-foot"><CircleHelp size={14} /><span>Signals are limited to recent returned history. No finding is a security verdict.</span></div>
                      {poisoningMatches.length > 0 && <div className="evidence-list" data-testid="list-lookalike-evidence"><span className="evidence-label">MATCHED EVIDENCE</span>{poisoningMatches.slice(0, 3).map((tx) => <div key={`${tx.chain}-${tx.hash}`} className="evidence-row"><button className="address-button mono" onClick={() => setIdentityAddress(tx.suspiciousAddress)} data-testid={`button-suspicious-address-${tx.hash}`}>{compactAddress(tx.suspiciousAddress)}</button><span>{tx.chain}</span><span className="mono">{compactAddress(tx.hash)}</span></div>)}</div>}
                      {approvalTransactions.length > 0 && <div className="evidence-list" data-testid="list-approval-evidence"><span className="evidence-label">APPROVAL LOG TRANSACTIONS</span>{approvalTransactions.slice(0, 3).map((tx) => <div key={`${tx.chain}-${tx.hash}`} className="evidence-row"><span>{tx.method}</span><span>{tx.chain}</span><span className="mono">{compactAddress(tx.hash)}</span></div>)}</div>}
                    </section>
                  </div>

                  <section className="panel transactions-panel reveal reveal-delay-2">
                    <div className="panel-heading transaction-heading">
                      <div><div className="section-overline">03 / RECENT ACTIVITY</div><h2>Transactions <span className="count-badge">{transactions.length}</span></h2></div>
                      <span className="transaction-source"><span className="live-dot" /> RETURNED BY SOURCE</span>
                    </div>
                    {transactions.length === 0 ? (
                      <div className="transaction-empty" data-testid="empty-transactions"><Activity size={18} /><span>No recent transactions were returned for these networks.</span></div>
                    ) : (
                      <div className="table-wrap">
                        <table>
                          <thead><tr><th>TRANSACTION</th><th>NETWORK</th><th>METHOD</th><th>COUNTERPARTY</th><th>VALUE</th><th>STATUS</th></tr></thead>
                          <tbody>{transactions.slice(0, 12).map((tx, index) => {
                            const outgoing = tx.from.toLowerCase() === submittedAddress.toLowerCase();
                            const counterpart = outgoing ? tx.to : tx.from;
                            return (
                              <tr key={`${tx.chain}-${tx.hash}-${index}`} data-testid={`row-transaction-${tx.hash}`}>
                                <td><span className="tx-direction">{outgoing ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}</span><span className="mono tx-hash">{compactAddress(tx.hash)}</span><span className="tx-time">{new Date(tx.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></td>
                                <td><span className="table-chain">{tx.chain}</span></td>
                                <td><span className="method-pill">{tx.method || 'Transfer'}</span></td>
                                <td className="mono counterpart">{counterpart ? <button className="address-button" onClick={() => setIdentityAddress(counterpart)} data-testid={`button-counterparty-${tx.hash}`}>{compactAddress(counterpart)}</button> : 'Contract creation'}</td>
                                <td className="mono tx-value">{quantity(tx.value, 6)}</td>
                                <td><span className={`tx-status ${tx.status.toLowerCase() === 'success' ? 'status-success' : 'status-other'}`}><i />{tx.status}</span></td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                    )}
                    <div className="panel-foot"><span>ACTIVITY IS LIMITED TO RECORDS RETURNED BY THE DATA SOURCE</span><span className="mono">{transactions.length > 12 ? 'SHOWING 12 OF ' : 'SHOWING '}{transactions.length}</span></div>
                  </section>
                </>
              )}
            </div>
          )}
          <footer className="page-footer"><span><Sparkles size={13} /> A research instrument, not a security oracle.</span><span>CHAINLENS <b>·</b> PUBLIC DATA ONLY</span></footer>
        </div>
      </main>

      <Dialog open={Boolean(identityAddress)} onOpenChange={(open) => { if (!open) setIdentityAddress(''); }}>
        <DialogContent className="identity-dialog" aria-labelledby="identity-title" data-testid="dialog-address-intelligence">
            <div className="dialog-head"><div><div className="section-overline">PUBLIC ADDRESS RECORD</div><DialogTitle className="dialog-title" id="identity-title">Address intelligence</DialogTitle></div><DialogClose asChild><button className="dialog-close" aria-label="Close address intelligence" data-testid="button-close-identity"><X size={18} /></button></DialogClose></div>
            <div className="identity-mark"><Fingerprint size={27} strokeWidth={1.4} /><span>IDENTITY LAYER</span></div>
            <div className="identity-address"><span className="mono" data-testid="text-identity-address">{compactAddress(identityAddress)}</span><button onClick={copyAddress} className="copy-address" data-testid="button-copy-address">{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copied' : 'Copy address'}</button></div>
            {metadataQuery.isLoading ? (
              <div className="metadata-loading" data-testid="state-metadata-loading"><div className="skeleton-block" /><div className="skeleton-block" /><span>LOOKING UP PUBLIC IDENTITY DATA</span></div>
            ) : metadataQuery.isError ? (
              <div className="metadata-state" data-testid="state-metadata-error"><AlertCircle size={17} /><div><strong>Metadata unavailable</strong><span>The public identity lookup did not complete.</span></div><button onClick={() => metadataQuery.refetch()} data-testid="button-retry-metadata">Retry</button></div>
            ) : metadata && metadata.hasMetadata ? (
              <div className="metadata-results" data-testid="state-metadata-found">
                <div className="identity-profile">{metadata.iconUrl ? <img src={metadata.iconUrl} alt="" className="profile-icon" data-testid="img-address-icon" /> : <div className="profile-fallback"><Fingerprint size={20} /></div>}<div><strong data-testid="text-address-name">{metadata.name || metadata.ensName || 'Unnamed address'}</strong><span>{metadata.ensName || 'Public address profile'}</span></div></div>
                {metadata.website && <a className="website-link" href={metadata.website.startsWith('http') ? metadata.website : `https://${metadata.website}`} target="_blank" rel="noreferrer" data-testid="link-address-website"><Globe2 size={15} />{metadata.website}<ExternalLink size={13} /></a>}
                <div className="tag-heading">PUBLIC TAGS <span className="mono">{metadata.tags.length}</span></div>
                {metadata.tags.length ? <div className="tag-list">{metadata.tags.map((tag, index) => <span key={`${tag}-${index}`} data-testid={`tag-address-${index}`}>{tag}</span>)}</div> : <div className="no-tags">No public tags are listed.</div>}
                <p className="metadata-footnote">Identity details are public metadata and may be incomplete or outdated.</p>
              </div>
            ) : (
              <div className="metadata-empty" data-testid="state-metadata-empty"><div className="empty-ring"><Fingerprint size={18} /></div><strong>No public identity attached</strong><span>No name, website, or tags were returned for this address.</span></div>
            )}
            <div className="dialog-footer"><span><span className="live-dot" /> METADATA SOURCE</span><span>PUBLIC REGISTRY DATA</span></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NotFound() {
  return <div className="not-found"><div className="brand-mark"><span /></div><div className="eyebrow">404 / NOT IN THIS FILE</div><h1 className="display">No address here.</h1><Link href="/dashboard" className="text-action" data-testid="link-return-dashboard">Return to investigation <ArrowRight size={15} /></Link></div>;
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
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
