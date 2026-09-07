import type { ReactNode } from 'react';
import { useGame } from '../../store/gameStore';
import type { IncidentEntry } from '../../engine/incidents';
import * as runtimeAgent from '../../engine/runtimeAgent';
import { Modal } from '../components/bits';

/**
 * The Mission Result UI.
 *
 * It names the Outcome tier that fired and reads out what its Incidents did. It shows **no score
 * and no percentage**, because none is computed — the run landed on a tier, and the tier is the
 * whole answer.
 */
export function MissionResult(): ReactNode {
    useGame((state) => state.version);

    const result = useGame((state) => state.result);
    const tables = useGame((state) => state.tables);
    const close = useGame((state) => state.closeOverlay);

    if (!result || !tables) return null;

    const tierName = tables.OutcomeType.get(result.outcomeType ?? '')?.displayName ?? result.outcomeType;

    return (
        <Modal onClose={close} label="Mission result">
            <div className="result">
                <div>
                    <span className="micro">{result.mission.data.displayName}</span>
                    <h2
                        className={
                            result.isSuccess
                                ? 'result__verdict result__verdict--win'
                                : 'result__verdict result__verdict--lose'
                        }
                    >
                        {result.isSuccess ? 'Objective met' : 'Objective failed'}
                    </h2>
                    <span className="meta">Outcome tier: {tierName}</span>
                </div>

                {result.reports
                    .filter((report) => !report.isSilent && report.description)
                    .map((report, index) => (
                        <p className="summary__body" key={`${report.incidentId}-${index}`}>
                            {report.description}
                        </p>
                    ))}

                <hr className="rule" />

                <div className="result__ledger">
                    <div className="ledger-row">
                        <span className="meta">Payment</span>
                        <span className="money">
                            {result.moneyEarned
                                ? `+$${result.moneyEarned.toLocaleString('en-US')}`
                                : '—'}
                        </span>
                    </div>
                    <div className="ledger-row">
                        <span className="meta">EXP</span>
                        <span>{result.expEarned ? `+${result.expEarned}` : '—'}</span>
                    </div>

                    {result.itemsLost.map((lost) => (
                        <div className="ledger-row" key={lost.itemId}>
                            <span className="meta">Lost in the field</span>
                            <span className="danger">
                                {tables.Item.get(lost.itemId)?.displayName ?? lost.itemId} ×{lost.qty}
                            </span>
                        </div>
                    ))}

                    {result.reports
                        .flatMap((report) => report.entries)
                        .filter(isHealthEntry)
                        .map((entry, index) => (
                            <div className="ledger-row" key={`${entry.characterId}-${index}`}>
                                <span className="meta">
                                    {nameOf(result.agents, entry.characterId)}
                                </span>
                                <span className={entry.delta < 0 ? 'danger' : 'money'}>
                                    {entry.delta > 0 ? `+${entry.delta}` : entry.delta} health
                                </span>
                            </div>
                        ))}
                </div>
            </div>

            <div className="modal__footer">
                <button type="button" className="btn btn--primary" onClick={close}>
                    Back to the board
                </button>
            </div>
        </Modal>
    );
}

function isHealthEntry(
    entry: IncidentEntry,
): entry is Extract<IncidentEntry, { kind: 'health' }> {
    return entry.kind === 'health';
}

function nameOf(agents: readonly runtimeAgent.RuntimeAgent[], characterId: string): string {
    const agent = agents.find((candidate) => candidate.characterId === characterId);
    return agent ? runtimeAgent.displayName(agent) : characterId;
}
