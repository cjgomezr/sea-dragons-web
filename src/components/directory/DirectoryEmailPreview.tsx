"use client";

import { Fragment } from "react";
import { useClubName } from "@/components/club/ClubNameProvider";
import {
  type DirectoryEmailBlock,
  type DirectoryEmailInline,
  type DirectoryEmailListItem,
  parseDirectoryEmailMessage,
} from "@/lib/directory/directory-email-markdown";
import type { Translator } from "@/lib/i18n/translator";
import type { EmailRecipient } from "./DirectoryEmailComposer";

/**
 * La vista previa del correo (#859, RF-4 y D5 del PRD de E33): el correo como
 * lo recibe un miembro. El cuerpo sale del mismo árbol que el servidor pinta
 * como HTML (`directory-email-markdown.ts`, #857), pintado aquí con React, así
 * que lo que se ve es lo que llega. Nada del autor se pinta como HTML: React
 * escapa cada texto.
 */

function Inlines({
  inlines,
}: {
  readonly inlines: readonly DirectoryEmailInline[];
}): React.JSX.Element {
  return (
    <>
      {inlines.map((inline, index) => (
        <InlineNode key={index} inline={inline} />
      ))}
    </>
  );
}

function InlineNode({
  inline,
}: {
  readonly inline: DirectoryEmailInline;
}): React.JSX.Element {
  switch (inline.type) {
    case "text":
      return <>{inline.value}</>;
    case "break":
      return <br />;
    case "strong":
      return (
        <strong>
          <Inlines inlines={inline.children} />
        </strong>
      );
    case "emphasis":
      return (
        <em>
          <Inlines inlines={inline.children} />
        </em>
      );
    case "link":
      return (
        <a href={inline.url} target="_blank" rel="noopener noreferrer">
          <Inlines inlines={inline.children} />
        </a>
      );
  }
}

/** Como en el HTML del correo: el párrafo de un elemento no lleva `<p>`, y
 * dos párrafos seguidos se separan con un salto. */
function ListItem({
  item,
}: {
  readonly item: DirectoryEmailListItem;
}): React.JSX.Element {
  return (
    <li>
      {item.children.map((block, index) => (
        <Fragment key={index}>
          {block.type === "list" ? (
            <Block block={block} />
          ) : (
            <>
              {index === 0 ? null : <br />}
              <Inlines inlines={block.children} />
            </>
          )}
        </Fragment>
      ))}
    </li>
  );
}

function Block({
  block,
}: {
  readonly block: DirectoryEmailBlock;
}): React.JSX.Element {
  if (block.type === "paragraph") {
    return (
      <p>
        <Inlines inlines={block.children} />
      </p>
    );
  }
  const items = block.children.map((item, index) => (
    <ListItem key={index} item={item} />
  ));
  return block.ordered ? (
    <ol start={block.start}>{items}</ol>
  ) : (
    <ul>{items}</ul>
  );
}

function MessageBody({
  translate,
  message,
}: {
  readonly translate: Translator;
  readonly message: string;
}): React.JSX.Element {
  if (message.trim() === "") {
    return (
      <p className="directory-email-preview-empty">
        {translate("directory.email.preview.empty")}
      </p>
    );
  }
  const { children } = parseDirectoryEmailMessage(message);
  return (
    <div className="directory-email-preview-body">
      {children.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Addressees({
  translate,
  recipients,
}: {
  readonly translate: Translator;
  readonly recipients: readonly EmailRecipient[];
}): React.JSX.Element {
  const [onlyRecipient] = recipients;
  return (
    <strong>
      {recipients.length === 1 && onlyRecipient !== undefined
        ? onlyRecipient.fullName
        : translate("directory.email.preview.everyone", {
            count: recipients.length,
          })}
    </strong>
  );
}

export function DirectoryEmailPreview({
  translate,
  id,
  labelledBy,
  isHidden,
  recipients,
  subject,
  message,
}: {
  readonly translate: Translator;
  readonly id: string;
  readonly labelledBy: string;
  readonly isHidden: boolean;
  readonly recipients: readonly EmailRecipient[];
  readonly subject: string;
  readonly message: string;
}): React.JSX.Element {
  const clubName = useClubName();
  return (
    <div
      className="directory-email-preview"
      role="tabpanel"
      id={id}
      aria-labelledby={labelledBy}
      tabIndex={0}
      hidden={isHidden}
    >
      {/* Escondida no se lee el mensaje: no hace falta en cada tecla. */}
      {isHidden ? null : (
        <>
          <div className="directory-email-preview-header">
            <p>
              {translate("directory.email.preview.from")}{" "}
              <strong>{clubName}</strong>
              {" · "}
              {translate("directory.email.preview.repliesToYou")}
            </p>
            <p>
              {translate("directory.email.preview.to")}{" "}
              <Addressees translate={translate} recipients={recipients} />
            </p>
            {subject.trim() === "" ? (
              <p className="directory-email-preview-no-subject">
                {translate("directory.email.preview.noSubject")}
              </p>
            ) : (
              <p className="directory-email-preview-subject">{subject}</p>
            )}
          </div>
          <MessageBody translate={translate} message={message} />
        </>
      )}
    </div>
  );
}
