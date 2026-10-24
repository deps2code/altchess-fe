import { CheckIcon, CloseIcon } from "../game/icons";

export type RuleState = "met" | "unmet";

export type Rule = { id: string; text: string; state: RuleState };

const STATE_LABEL: Record<RuleState, string> = {
  met: "Requirement met",
  unmet: "Requirement not met",
};

/** A bulleted list where each line carries a round tick or cross, so a form
 *  can say what a field needs before the user submits and what the server
 *  refused after. Also the shape server errors are shown in. */
export function RuleList({ rules, alert = false }: { rules: Rule[]; alert?: boolean }) {
  return (
    <ul className={alert ? "rules server-error" : "rules"} role={alert ? "alert" : undefined}>
      {rules.map((rule) => (
        <li key={rule.id} data-state={rule.state}>
          <span className="rule-mark" aria-hidden="true">
            {rule.state === "met" ? <CheckIcon /> : rule.state === "unmet" ? <CloseIcon /> : null}
          </span>
          <span className="sr-only">{STATE_LABEL[rule.state]}: </span>
          {rule.text}
        </li>
      ))}
    </ul>
  );
}
