import Link from "next/link";
import { LandingShell } from "@/components/landing/landing-shell";
import { contactEmail, extensionInstallUrl } from "@/lib/config";
import { LEGAL_UPDATED, sectionId, type LegalDocument } from "@/lib/legal";
import { INSTALL_HREF, ROUTES } from "@/lib/routes";

/** A public legal document on the landing look: dated title, contents, sections, and the contact line. */
export function LegalPage({ document }: { document: LegalDocument }) {
  const email = contactEmail();
  return (
    <LandingShell installHref={extensionInstallUrl() ?? INSTALL_HREF}>
      <article className="ac-legal" aria-labelledby="legal-title">
        <h1 id="legal-title">{document.title}</h1>
        <p className="ac-legal-updated">Last updated {LEGAL_UPDATED}</p>
        <nav className="ac-legal-toc" aria-label="On this page">
          <h2>On this page</h2>
          <ol>
            {document.sections.map((section) => (
              <li key={section.heading}>
                <a href={`#${sectionId(section.heading)}`}>{section.heading}</a>
              </li>
            ))}
          </ol>
        </nav>
        {document.sections.map((section) => (
          <section
            key={section.heading}
            id={sectionId(section.heading)}
            aria-labelledby={`${sectionId(section.heading)}-title`}
          >
            <h2 id={`${sectionId(section.heading)}-title`}>{section.heading}</h2>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.items ? (
              <ul>
                {section.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {section.table ? (
              <table className="ac-legal-table">
                <thead>
                  <tr>
                    {section.table.head.map((cell) => (
                      <th key={cell} scope="col">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row) => (
                    <tr key={row[0]}>
                      {row.map((cell, index) =>
                        index === 0 ? (
                          <th key={cell} scope="row">
                            {cell}
                          </th>
                        ) : (
                          <td key={cell}>{cell}</td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
            {section.link ? (
              <p>
                <a href={section.link.href} target="_blank" rel="noopener noreferrer">
                  {section.link.label}
                </a>
              </p>
            ) : null}
          </section>
        ))}
        <section id="contact" aria-labelledby="contact-title">
          <h2 id="contact-title">Contact</h2>
          <p>
            {email ? (
              <>
                Questions about this document, or a request to access, correct, or delete your
                information? Email <a href={`mailto:${email}`}>{email}</a>.
              </>
            ) : (
              "Questions about this document? Contact us through the Acorn website."
            )}
          </p>
          <p>
            <Link href={ROUTES.privacy}>Privacy Policy</Link> ·{" "}
            <Link href={ROUTES.terms}>Terms of Service</Link>
          </p>
        </section>
      </article>
    </LandingShell>
  );
}
