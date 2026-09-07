import type { ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import { allMocks } from '../../mocks';
import { ALL_SHEETS } from '../../data/sheets';

/**
 * Which data is loaded, and how to load different data.
 *
 * Switching scenario reloads with a new query string rather than swapping tables in place: the
 * engine holds live objects that a mid-run swap would leave inconsistent, and putting the choice in
 * the URL means it can be bookmarked, shared, or opened on a phone.
 */
export function DataPanel(): ReactNode {
    const show = useGame((state) => state.showDataPanel);
    const toggle = useGame((state) => state.toggleDataPanel);
    const data = useGame((state) => state.data);
    const seed = useGame((state) => state.seed);

    if (!show) {
        return (
            <button type="button" className="btn btn--small devpanel__toggle" onClick={toggle}>
                Data
            </button>
        );
    }

    const errors = data?.issues.filter((issue) => issue.severity === 'error') ?? [];
    const warnings = data?.issues.filter((issue) => issue.severity === 'warning') ?? [];
    const populated = ALL_SHEETS.filter((sheet) => (data?.counts[sheet] ?? 0) > 0);

    return (
        <div className="devpanel">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <strong className="micro">Data</strong>
                <button type="button" className="btn btn--small btn--quiet" onClick={toggle}>
                    Hide
                </button>
            </div>

            <div className="meta" style={{ marginBottom: 8 }}>
                Layers:{' '}
                {data?.layers
                    .map((layer) => (layer.error ? `${layer.id} (failed)` : layer.id))
                    .join(' + ')}
                <br />
                RNG seed: {seed}
            </div>

            {data?.layers
                .filter((layer) => layer.error)
                .map((layer) => (
                    <div className="devpanel__issue" key={layer.id}>
                        {layer.error}
                    </div>
                ))}

            <div style={{ margin: '10px 0' }}>
                <div className="micro" style={{ marginBottom: 4 }}>
                    Load a scenario
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    <ScenarioLink label="seed only" search="?data=seed" />
                    <ScenarioLink label="no sheet" search="?nosheet=1" />
                    {allMocks().map((mock) => (
                        <ScenarioLink
                            key={mock.name}
                            label={mock.name}
                            search={`?mock=${mock.name}`}
                            title={mock.description}
                        />
                    ))}
                </div>
            </div>

            <hr className="rule" />

            <div style={{ margin: '10px 0' }}>
                <div className="micro" style={{ marginBottom: 4 }}>
                    {errors.length} errors · {warnings.length} warnings
                </div>
                {errors.slice(0, 12).map((issue, index) => (
                    <div className="devpanel__issue" key={index}>
                        {issue.message}
                    </div>
                ))}
                {errors.length > 12 ? (
                    <div className="devpanel__warn">…and {errors.length - 12} more</div>
                ) : null}
            </div>

            <hr className="rule" />

            <div className="devpanel__grid" style={{ marginTop: 10 }}>
                {populated.map((sheet) => (
                    <ExpandedRow key={sheet} label={sheet} value={data!.counts[sheet]} />
                ))}
            </div>
        </div>
    );
}

function ExpandedRow({ label, value }: { label: string; value: number }): ReactNode {
    return (
        <>
            <span>{label}</span>
            <span>{value}</span>
        </>
    );
}

function ScenarioLink({
    label,
    search,
    title,
}: {
    label: string;
    search: string;
    title?: string;
}): ReactNode {
    const active = window.location.search === search;
    return (
        <a
            className="btn btn--small"
            href={`${window.location.pathname}${search}`}
            title={title}
            style={active ? { background: 'var(--cyan)', color: 'var(--inverse)' } : undefined}
        >
            {label}
        </a>
    );
}
