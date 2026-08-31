// src/actions/ui/action-panel.ts

// UI rendering utilities for actions
// This module provides classes to render actions in various formats (HTML, Markdown, JSON, ASCII table)
// and to filter/sort/search/group actions.

import type {
  OntologyAction,
  ActionPanel,
  ActionFilter,
  ActionSortOptions,
  ActionPriority,
  ActionStatus,
} from "../types.js";

/** Simple mapping of action type to an icon (you can extend) */
const TYPE_ICONS: Record<string, string> = {
  validation: "🔍",
  enrichment: "✨",
  optimization: "⚙️",
  business: "💼",
  research: "📚",
  integration: "🔗",
};

/** Mapping priority to color class (used in HTML) */
const PRIORITY_COLORS: Record<ActionPriority, string> = {
  critical: "red",
  high: "orange",
  medium: "yellow",
  low: "green",
};

/** Mapping priority to emoji (used in textual formats) */
const PRIORITY_EMOJIS: Record<ActionPriority, string> = {
  critical: "🔴",
  high: "🔶",
  medium: "🟡",
  low: "🟢",
};

/** Helper class that implements the ActionPanel interface and adds rendering methods */
class ActionPanelImpl implements ActionPanel {
  title: string;
  sections: {
    title: string;
    actions: OntologyAction[];
    icon?: string;
    collapsible?: boolean;
    collapsed_by_default?: boolean;
  }[];
  metadata?: Record<string, any>;
  total_actions: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  completed_count: number;
  pending_count: number;
  failed_count: number;

  constructor(panel: ActionPanel) {
    this.title = panel.title;
    this.sections = panel.sections;
    this.metadata = panel.metadata;
    this.total_actions = panel.total_actions ?? 0;
    this.critical_count = panel.critical_count ?? 0;
    this.high_count = panel.high_count ?? 0;
    this.medium_count = panel.medium_count ?? 0;
    this.low_count = panel.low_count ?? 0;
    this.completed_count = panel.completed_count ?? 0;
    this.pending_count = panel.pending_count ?? 0;
    this.failed_count = panel.failed_count ?? 0;
  }

  /** Render the entire panel as HTML */
  toHTML(): string {
    const sectionsHtml = this.sections
      .map((sec) => {
        const header = `<h2 style="display:flex;align-items:center;">${sec.icon || ""} ${sec.title}</h2>`;
        const actionsHtml = sec.actions.map((a) => new ActionPanelRenderer().renderActionCard(a)).join("\n");
        const collapsibleAttr = sec.collapsible ? `data-collapsible="true" data-collapsed="${sec.collapsed_by_default ?? true}"` : "";
        return `<section ${collapsibleAttr}>${header}<div class="actions">${actionsHtml}</div></section>`;
      })
      .join("\n");
    return `
      <div class="action-panel">
        <h1>${this.title}</h1>
        ${sectionsHtml}
      </div>
    `;
  }

  /** Render the panel as Markdown */
  toMarkdown(): string {
    const sectionsMd = this.sections
      .map((sec) => {
        const header = `## ${sec.title}`;
        const actionsMd = sec.actions
          .map((a) => {
            const priority = new ActionPanelRenderer().formatPriority(a.priority);
            const impact = new ActionPanelRenderer().formatImpact(a.impact_score);
            const duration = new ActionPanelRenderer().formatDuration(a.estimated_effort);
            return `- ${priority} **${a.title}** (${a.type})\n  - ${a.description}\n  - \`${a.suggested_command}\`\n  - Impact: ${impact}\n  - Effort: ${duration}`;
          })
          .join("\n");
        return `${header}\n${actionsMd}`;
      })
      .join("\n\n");
    return `# ${this.title}\n\n${sectionsMd}`;
  }

  /** Render the panel as JSON string */
  toJSON(): string {
    return JSON.stringify({ title: this.title, sections: this.sections, metadata: this.metadata }, null, 2);
  }

  /** Render an ASCII table summary of actions */
  toTable(): string {
    const rows: string[] = [];
    const header = ["ID", "Title", "Priority", "Status", "Impact", "Effort"].join(" | ");
    const separator = header.replace(/[^|]/g, "-");
    rows.push(header);
    rows.push(separator);
    this.sections.forEach((sec) => {
      sec.actions.forEach((a) => {
        const row = [
          a.id,
          a.title,
          a.priority,
          a.status,
          `${a.impact_score}/10`,
          `${a.estimated_effort}min`,
        ].join(" | ");
        rows.push(row);
      });
    });
    return rows.join("\n");
  }
}

/** Main renderer class */
export class ActionPanelRenderer {
  /** Render an ActionPanel object from raw actions and optional filter */
  renderActionPanel(actions: OntologyAction[], filter?: ActionFilter): ActionPanel {
    const filtered = filter ? new ActionPanelFilter().filter(actions, filter) : actions;
    const sections = this._groupIntoSections(filtered);
    const summary = this.renderActionSummary(filtered);
    const panel: ActionPanel = {
      title: `Action Panel – ${summary.total} actions (${summary.critical} critical, ${summary.high} high, ${summary.medium} medium, ${summary.low} low)`,
      sections,
      total_actions: summary.total,
      critical_count: summary.critical,
      high_count: summary.high,
      medium_count: summary.medium,
      low_count: summary.low,
      completed_count: filtered.filter(a => a.status === 'completed').length,
      pending_count: filtered.filter(a => a.status === 'pending').length,
      failed_count: filtered.filter(a => a.status === 'failed').length,
    };
    return new ActionPanelImpl(panel);
  }

  /** Simple HTML list of actions (maxItems limits) */
  renderActionList(actions: OntologyAction[], maxItems?: number): string {
    const list = (maxItems ? actions.slice(0, maxItems) : actions)
      .map((a) => `<li>${this.renderActionCard(a)}</li>`)
      .join("\n");
    return `<ul class="action-list">${list}</ul>`;
  }

  /** Render a single action as an HTML card */
  renderActionCard(action: OntologyAction): string {
    const icon = TYPE_ICONS[action.type] ?? "⚡";
    const color = PRIORITY_COLORS[action.priority];
    const priorityBadge = `<span style="background:${color};color:white;padding:2px 6px;border-radius:4px;">${action.priority.toUpperCase()}</span>`;
    const impact = this.formatImpact(action.impact_score);
    const effort = this.formatDuration(action.estimated_effort);
    const status = `<span>${action.status}</span>`;
    return `
      <div class="action-card" style="border:1px solid #ddd;padding:10px;margin:5px;border-left:5px solid ${color};">
        <div class="header" style="display:flex;justify-content:space-between;align-items:center;">
          <h3>${icon} ${action.title} ${priorityBadge}</h3>
          <div class="status">${status}</div>
        </div>
        <p>${action.description}</p>
        <pre><code>${action.suggested_command}</code></pre>
        <div class="meta" style="font-size:0.9em;color:#555;">
          <span>Impact: ${impact}</span> | <span>Effort: ${effort}</span>
        </div>
        <div class="actions" style="margin-top:8px;">
          <button data-action-id="${action.id}" class="execute-btn">Execute</button>
          <button data-action-id="${action.id}" class="skip-btn">Skip / Dismiss</button>
        </div>
      </div>
    `;
  }

  /** Compute summary statistics for a list of actions */
  renderActionSummary(actions: OntologyAction[]) {
    const summary = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      total: actions.length,
    };
    actions.forEach((a) => {
      switch (a.priority) {
        case "critical":
          summary.critical++;
          break;
        case "high":
          summary.high++;
          break;
        case "medium":
          summary.medium++;
          break;
        case "low":
          summary.low++;
          break;
      }
    });
    return summary;
  }

  /** Group actions by their category */
  renderActionByCategory(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.category ?? "uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Group actions by type */
  renderActionByType(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Group actions by status */
  renderActionByStatus(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Convert minutes to human‑readable duration */
  formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins ? `${hrs} hour ${mins} min` : `${hrs} hour`;
  }

  /** Render priority with emoji */
  formatPriority(priority: ActionPriority): string {
    return `${PRIORITY_EMOJIS[priority]} ${priority}`;
  }

  /** Render impact score with descriptor */
  formatImpact(score: number): string {
    let level = "Low";
    if (score >= 8) level = "High";
    else if (score >= 5) level = "Medium";
    return `${level} Impact (${score}/10)`;
  }

  /** Private helper: split actions into sections (by category) */
  private _groupIntoSections(actions: OntologyAction[]) {
    const byCategory = this.renderActionByCategory(actions);
    return Object.entries(byCategory).map(([cat, acts]) => ({
      title: cat,
      actions: acts,
      icon: TYPE_ICONS[acts[0]?.type] ?? "⚡",
      collapsible: true,
      collapsed_by_default: false,
    }));
  }
}

/** Filtering, sorting and grouping utilities */
export class ActionPanelFilter {
  /** Filter actions based on a filter object */
  filter(actions: OntologyAction[], filter: ActionFilter): OntologyAction[] {
    return actions.filter((a) => {
      if (filter.types && !filter.types.includes(a.type)) return false;
      if (filter.priorities && !filter.priorities.includes(a.priority)) return false;
      if (filter.categories && !filter.categories.includes(a.category)) return false;
      if (filter.tags && !filter.tags.some((t) => a.tags.includes(t))) return false;
      if (filter.status && !filter.status.includes(a.status)) return false;
      if (filter.min_impact !== undefined && a.impact_score < filter.min_impact) return false;
      if (filter.max_effort !== undefined && a.estimated_effort > filter.max_effort) return false;
      if (filter.search) {
        const q = filter.search.toLowerCase();
        if (!a.title.toLowerCase().includes(q) && !a.description.toLowerCase().includes(q) && !a.suggested_command.toLowerCase().includes(q)) {
          return false;
        }
      }
      return true;
    });
  }

  /** Sort actions according to sort options */
  sort(actions: OntologyAction[], sort: ActionSortOptions): OntologyAction[] {
    const copy = [...actions];
    copy.sort((a, b) => {
      let av: any = (a as any)[sort.field];
      let bv: any = (b as any)[sort.field];
      // Convert dates to timestamps for comparison
      if (sort.field.endsWith("_at")) {
        av = new Date(av).getTime();
        bv = new Date(bv).getTime();
      }
      if (av < bv) return sort.direction === "asc" ? -1 : 1;
      if (av > bv) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });
    return copy;
  }

  /** Simple text search across title/description/command */
  search(actions: OntologyAction[], query: string): OntologyAction[] {
    const q = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.suggested_command.toLowerCase().includes(q)
    );
  }

  /** Group by category */
  groupByCategory(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.category ?? "uncategorized";
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Group by type */
  groupByType(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.type;
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Group by priority */
  groupByPriority(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.priority;
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }

  /** Group by status */
  groupByStatus(actions: OntologyAction[]): Record<string, OntologyAction[]> {
    return actions.reduce((acc, cur) => {
      const key = cur.status;
      if (!acc[key]) acc[key] = [];
      acc[key].push(cur);
      return acc;
    }, {} as Record<string, OntologyAction[]>);
  }
}
