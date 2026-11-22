import type { ReactNode } from "react";
import type { WorkspaceChannel } from "../channel.ts";
import type { PlanningSession } from "./read.ts";
import type { CatalogActions } from "./useCatalog.ts";
import type { PlanningNavigation } from "./usePlanningNavigation.ts";
import { Forecast } from "./Forecast.tsx";
import { Review } from "./Review.tsx";
import { Perspectives } from "./Perspectives.tsx";
import { Focus, PersonalNotice } from "./Focus.tsx";
import "./planning.css";

interface Props {
  session: PlanningSession;
  catalog: CatalogActions;
  navigation: PlanningNavigation;
  channel: WorkspaceChannel;
  disabled: boolean;
  openSource: (id: string) => void;
  search: () => void;
  children: ReactNode;
}

export function PlanningArea({
  session,
  catalog,
  navigation,
  channel,
  disabled,
  openSource,
  search,
  children,
}: Props) {
  const actions = {
    selected: navigation.selection,
    select: navigation.select,
    report: navigation.report,
    open: openSource,
  };
  const version = catalog.data?.personalVersion ?? 0;
  let content = children;
  switch (navigation.page) {
    case "forecast":
      content = (
        <Forecast session={session} personalVersion={version} {...actions} />
      );
      break;
    case "review":
      content = (
        <Review
          session={session}
          channel={channel}
          disabled={disabled}
          personalVersion={version}
          {...actions}
        />
      );
      break;
    case "perspectives":
      content = (
        <Perspectives
          session={session}
          catalog={catalog}
          choice={navigation.choice}
          setChoice={navigation.setChoice}
          source={navigation.source}
          {...actions}
        />
      );
      break;
  }
  return (
    <>
      <div className="planning-tools">
        <Focus snapshot={session.snapshot} catalog={catalog} />
        {navigation.page !== "perspectives" && (
          <button onClick={search}>Search…</button>
        )}
        {navigation.page && navigation.selection.length === 1 && (
          <button onClick={() => openSource(navigation.selection[0])}>
            Show in project
          </button>
        )}
      </div>
      <PersonalNotice catalog={catalog} />
      {content}
    </>
  );
}
