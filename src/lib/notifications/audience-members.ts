/**
 * A quién llega un aviso para una audiencia: todo el club o los socios de
 * unos grupos. Lo comparten las noticias (#332) y los eventos (#310), que
 * guardan su audiencia con la misma forma.
 */

export type ClubAudience =
  | { readonly kind: "club" }
  | { readonly kind: "groups"; readonly groupIds: readonly string[] };

export type AudienceMembersGateway = {
  /** Los socios del club a los que llega la audiencia, esté como esté su
   * cuenta: todos, o los de alguno de esos grupos. */
  findAudienceMemberIds(query: {
    readonly clubId: string;
    readonly audience: ClubAudience;
  }): Promise<readonly string[]>;
};
