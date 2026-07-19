import * as React from "react"

import { cn } from "@/lib/utils"

type SectionHeaderContentProps = {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

type SectionHeaderProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "title"
> & SectionHeaderContentProps & {
  titleId?: string
}

function SectionHeader({
  actions,
  className,
  description,
  title,
  titleId,
  ...props
}: SectionHeaderProps) {
  if (!title && !description && !actions) return null

  return (
    <div
      data-slot="section-header"
      className={cn("flex min-w-0 items-start justify-between gap-4", className)}
      {...props}
    >
      <div className="min-w-0">
        {title ? (
          <h2 id={titleId} className="text-sm font-semibold leading-5 text-foreground">{title}</h2>
        ) : null}
        {description ? (
          <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

type SectionProps = Omit<React.HTMLAttributes<HTMLElement>, "title"> &
  SectionHeaderContentProps & {
    variant?: "default" | "outlined"
  }

const Section = React.forwardRef<HTMLElement, SectionProps>(
  (
    {
      actions,
      children,
      className,
      description,
      title,
      variant = "default",
      ...props
    },
    ref,
  ) => (
    <section
      ref={ref}
      data-slot="section"
      className={cn(
        "min-w-0",
        variant === "default" && "border-b border-border/60 pb-6 last:border-b-0",
        variant === "outlined" && "rounded-xl bg-card p-5 shadow-xs ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      <SectionHeader title={title} description={description} actions={actions} />
      <div className={cn((title || description || actions) && "mt-4")}>{children}</div>
    </section>
  ),
)
Section.displayName = "Section"

type FormSectionProps = Omit<
  React.FieldsetHTMLAttributes<HTMLFieldSetElement>,
  "title"
> &
  SectionHeaderContentProps & {
    variant?: "default" | "outlined"
  }

const FormSection = React.forwardRef<HTMLFieldSetElement, FormSectionProps>(
  (
    {
      "aria-labelledby": ariaLabelledBy,
      actions,
      children,
      className,
      description,
      title,
      variant = "default",
      ...props
    },
    ref,
  ) => {
    const generatedTitleId = React.useId()
    const titleId = title ? generatedTitleId : undefined

    return (
      <fieldset
        ref={ref}
        aria-labelledby={ariaLabelledBy ?? titleId}
        data-slot="form-section"
        className={cn(
          "min-w-0",
          variant === "default" && "border-b border-border/60 pb-6 last:border-b-0",
          variant === "outlined" && "rounded-xl bg-card p-5 shadow-xs ring-1 ring-foreground/10",
          className,
        )}
        {...props}
      >
        <SectionHeader title={title} titleId={titleId} description={description} actions={actions} />
        <div className={cn("grid gap-4", (title || description || actions) && "mt-4")}>
          {children}
        </div>
      </fieldset>
    )
  },
)
FormSection.displayName = "FormSection"

export {
  FormSection,
  Section,
  SectionHeader,
  type FormSectionProps,
  type SectionHeaderProps,
  type SectionProps,
}
