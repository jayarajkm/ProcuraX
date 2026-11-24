import { Fragment } from 'react'

/** Renders plain text with `**bold**` and newlines as React nodes (never as HTML). */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith('**') && part.endsWith('**') && part.length > 4
              ? <strong key={j}>{part.slice(2, -2)}</strong>
              : <Fragment key={j}>{part}</Fragment>)}
        </Fragment>
      ))}
    </>
  )
}
