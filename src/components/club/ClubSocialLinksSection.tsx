"use client";

import type { Icon as PhosphorGlyph } from "@phosphor-icons/react/dist/lib/types";
import { FacebookLogo } from "@phosphor-icons/react/dist/ssr/FacebookLogo";
import { Globe } from "@phosphor-icons/react/dist/ssr/Globe";
import { InstagramLogo } from "@phosphor-icons/react/dist/ssr/InstagramLogo";
import { TiktokLogo } from "@phosphor-icons/react/dist/ssr/TiktokLogo";
import { WhatsappLogo } from "@phosphor-icons/react/dist/ssr/WhatsappLogo";
import { YoutubeLogo } from "@phosphor-icons/react/dist/ssr/YoutubeLogo";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import type { ApiRequestFailure } from "@/lib/api/request-api";
import {
  isSameSocialLinks,
  NO_SOCIAL_LINKS,
  SOCIAL_NETWORKS,
  type SocialLinkIssue,
  type SocialLinks,
  type SocialNetwork,
  validateSocialLinks,
} from "@/lib/club/social-links";
import type { Translator } from "@/lib/i18n/translator";
import { describeClubSettingsFailure } from "./club-settings-client";
import {
  describeSocialLinkIssue,
  loadSocialLinks,
  readSocialLinkIssue,
  saveSocialLinks,
} from "./club-social-links-client";
import { SavedNotice, UnsavedChangesBar } from "./ClubUnsavedChangesBar";
import {
  type ClubDraft,
  type ClubDraftStatus,
  type DraftSaveOutcome,
  useClubDraft,
} from "./use-club-draft";

/**
 * Las redes del club en su configuración (#963, RF-1 del PRD de E37): un
 * campo por red, con su icono, y vacío es "sin esa red". Sigue el patrón de
 * la sección del inicio de sesión: borrador, barra de cambios sin guardar y
 * aviso al salir.
 *
 * Un enlace se valida al guardar, no mientras se escribe: a medio pegar
 * todos son inválidos. El aviso de un campo se va en cuanto se toca.
 */

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded" }
  | ApiRequestFailure;

type Draft = { readonly [N in SocialNetwork]: string };

const HEADING_ID = "club-redes";

const NETWORK_ICONS: Readonly<Record<SocialNetwork, PhosphorGlyph>> = {
  instagram: InstagramLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
  facebook: FacebookLogo,
  whatsapp: WhatsappLogo,
  website: Globe,
};

/** De muestra, la forma del enlace que espera cada red. Un enlace es el
 * mismo en los dos idiomas, así que no se traduce. */
const NETWORK_PLACEHOLDERS: Readonly<Record<SocialNetwork, string>> = {
  instagram: "https://www.instagram.com/…",
  tiktok: "https://www.tiktok.com/@…",
  youtube: "https://www.youtube.com/@…",
  facebook: "https://www.facebook.com/…",
  whatsapp: "https://wa.me/61…",
  website: "https://…",
};

function toDraft(links: SocialLinks): Draft {
  return {
    instagram: links.instagram ?? "",
    tiktok: links.tiktok ?? "",
    youtube: links.youtube ?? "",
    facebook: links.facebook ?? "",
    whatsapp: links.whatsapp ?? "",
    website: links.website ?? "",
  };
}

/** Un campo en blanco viaja como `null`: quitar esa red. */
function toLinks(draft: Draft): SocialLinks {
  const blankAsNull = (url: string): string | null =>
    url.trim() === "" ? null : url;
  return {
    instagram: blankAsNull(draft.instagram),
    tiktok: blankAsNull(draft.tiktok),
    youtube: blankAsNull(draft.youtube),
    facebook: blankAsNull(draft.facebook),
    whatsapp: blankAsNull(draft.whatsapp),
    website: blankAsNull(draft.website),
  };
}

function isSameDraft(draft: Draft, saved: Draft): boolean {
  return isSameSocialLinks(toLinks(draft), toLinks(saved));
}

async function sendLinks(draft: Draft): Promise<DraftSaveOutcome<Draft>> {
  const result = await saveSocialLinks(toLinks(draft));
  return result.kind === "failed"
    ? result
    : { kind: "saved", value: toDraft(result.links) };
}

function SocialLinkInput({
  translate,
  network,
  value,
  issue,
  onChange,
}: {
  translate: Translator;
  network: SocialNetwork;
  value: string;
  issue: SocialLinkIssue | null;
  onChange: (url: string) => void;
}): React.JSX.Element {
  const id = `club-red-${network}`;
  const issueId = `${id}-aviso`;
  const helpId = `${id}-ayuda`;
  const hasHelp = network === "whatsapp";
  const describedBy = [
    issue === null ? null : issueId,
    hasHelp ? helpId : null,
  ].filter((part) => part !== null);
  return (
    <div className="auth-field club-social-link">
      <label htmlFor={id}>
        <Icon glyph={NETWORK_ICONS[network]} />
        {translate(`clubSettings.socialLinks.network.${network}`)}
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        placeholder={NETWORK_PLACEHOLDERS[network]}
        value={value}
        aria-invalid={issue !== null}
        aria-describedby={
          describedBy.length === 0 ? undefined : describedBy.join(" ")
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {issue === null ? null : (
        <p className="auth-field-error" id={issueId}>
          {describeSocialLinkIssue(translate, issue)}
        </p>
      )}
      {hasHelp ? (
        <p className="auth-hint" id={helpId}>
          {translate("clubSettings.socialLinks.whatsappHelp")}
        </p>
      ) : null}
    </div>
  );
}

function SaveFailure({
  translate,
  status,
}: {
  translate: Translator;
  status: ClubDraftStatus;
}): React.JSX.Element | null {
  // Un 400 de una red ya se enseña junto a su campo.
  if (status.kind !== "failed" || readSocialLinkIssue(status) !== null) {
    return null;
  }
  return (
    <p className="auth-error" role="alert">
      {describeClubSettingsFailure(translate, status)}
    </p>
  );
}

/** Lee lo guardado una vez, al montar, y lo da por guardado en el
 * borrador. `replaceSaved` no cambia, así que el efecto no se repite. */
function useInitialLoad(replaceSaved: (draft: Draft) => void): LoadState {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  useEffect(() => {
    let isCurrent = true;
    void loadSocialLinks().then((outcome) => {
      if (!isCurrent) {
        return;
      }
      if (outcome.kind === "failed") {
        setLoad(outcome);
        return;
      }
      replaceSaved(toDraft(outcome.links));
      setLoad({ kind: "loaded" });
    });
    return () => {
      isCurrent = false;
    };
  }, [replaceSaved]);
  return load;
}

/** El aviso de cada red: el que encontró el formulario al guardar o, si el
 * servidor rechazó, el suyo. */
function issueOf(
  network: SocialNetwork,
  localIssues: readonly SocialLinkIssue[],
  status: ClubDraftStatus,
): SocialLinkIssue | null {
  const local = localIssues.find((issue) => issue.network === network);
  if (local !== undefined) {
    return local;
  }
  const server = status.kind === "failed" ? readSocialLinkIssue(status) : null;
  return server?.network === network ? server : null;
}

function SocialLinksForm({
  translate,
  links,
}: {
  translate: Translator;
  links: ClubDraft<Draft>;
}): React.JSX.Element {
  const { draft, status } = links;
  const [localIssues, setLocalIssues] = useState<readonly SocialLinkIssue[]>(
    [],
  );
  const isSending = status.kind === "sending";

  function update(network: SocialNetwork, url: string): void {
    setLocalIssues((current) =>
      current.filter((issue) => issue.network !== network),
    );
    links.change((current) => ({ ...current, [network]: url }));
  }

  function save(): void {
    const validation = validateSocialLinks(toLinks(draft));
    if (validation.kind === "invalid") {
      setLocalIssues(validation.issues);
      return;
    }
    setLocalIssues([]);
    void links.save();
  }

  return (
    <form
      className="auth-pending club-settings-form"
      onSubmit={(event) => event.preventDefault()}
      noValidate
    >
      <p className="app-lead">{translate("clubSettings.socialLinks.lead")}</p>
      {/* Mientras se guarda no se edita: lo que se escribiera ahora lo
          pisaría lo que devuelva el servidor. */}
      <fieldset
        className="member-record-fields club-social-links"
        disabled={isSending}
      >
        {SOCIAL_NETWORKS.map((network) => (
          <SocialLinkInput
            key={network}
            translate={translate}
            network={network}
            value={draft[network]}
            issue={issueOf(network, localIssues, status)}
            onChange={(url) => update(network, url)}
          />
        ))}
      </fieldset>
      <SaveFailure translate={translate} status={status} />
      {links.hasDraft ? (
        <UnsavedChangesBar
          translate={translate}
          section="social"
          headingId={HEADING_ID}
          canSave
          isSaving={isSending}
          onDiscard={() => {
            setLocalIssues([]);
            links.discard();
          }}
          onSave={save}
        />
      ) : null}
      <SavedNotice
        translate={translate}
        isShowing={links.isSavedNoticeShowing}
      />
    </form>
  );
}

export function ClubSocialLinksSection({
  translate,
  onHasDraftChange,
}: {
  translate: Translator;
  onHasDraftChange: (hasDraft: boolean) => void;
}): React.JSX.Element {
  const links = useClubDraft<Draft>({
    initial: toDraft(NO_SOCIAL_LINKS),
    isSame: isSameDraft,
    send: sendLinks,
    onHasDraftChange,
  });
  const load = useInitialLoad(links.replaceSaved);

  return (
    <section className="auth-fields" aria-labelledby={HEADING_ID}>
      <h2 id={HEADING_ID} tabIndex={-1}>
        {translate("clubSettings.socialLinks.title")}
      </h2>
      {load.kind === "loading" ? (
        <p className="admin-empty">
          {translate("clubSettings.socialLinks.loading")}
        </p>
      ) : null}
      {load.kind === "failed" ? (
        <p className="auth-error" role="alert">
          {describeClubSettingsFailure(translate, load)}
        </p>
      ) : null}
      {load.kind === "loaded" ? (
        <SocialLinksForm translate={translate} links={links} />
      ) : null}
    </section>
  );
}
