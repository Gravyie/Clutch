"use client"

// Magic UI "Text Reveal" (magicui.design/docs/components/text-reveal), extended with an inline mode: the original
// pins a 200vh section; inline reveals words in place as the paragraph scrolls through the viewport. Colours follow
// currentColor so it works on any surface.

import {
  useRef,
  type ComponentPropsWithoutRef,
  type FC,
  type ReactNode,
} from "react"
import { motion, MotionValue, useReducedMotion, useScroll, useTransform } from "motion/react"

import { cn } from "@/lib/utils"

export interface TextRevealProps extends ComponentPropsWithoutRef<"div"> {
  children: string
  /** "sticky" pins the text while a tall section scrolls (original); "inline" reveals it in normal flow */
  mode?: "sticky" | "inline"
  /** classes for the text itself (size, font, leading) */
  textClassName?: string
  /** opacity of words not yet revealed */
  dim?: number
}

export const TextReveal: FC<TextRevealProps> = ({ children, className, mode = "sticky", textClassName, dim = 0.2 }) => {
  const sectionRef = useRef<HTMLDivElement | null>(null)
  const reduce = useReducedMotion()
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: mode === "inline" ? ["start 85%", "end 40%"] : undefined,
  })

  if (typeof children !== "string") {
    throw new Error("TextReveal: children must be a string")
  }

  const words = children.split(" ")
  const text = (
    <span className={cn("flex flex-wrap", textClassName)}>
      <span className="sr-only">{children}</span>
      {words.map((word, i) => {
        const start = i / words.length
        const end = start + 1 / words.length
        return (
          <Word key={i} progress={scrollYProgress} range={[start, end]} dim={dim} still={!!reduce}>
            {word}
          </Word>
        )
      })}
    </span>
  )

  if (mode === "inline") {
    return (
      <div ref={sectionRef} className={cn("relative", className)}>
        {text}
      </div>
    )
  }

  return (
    <div ref={sectionRef} className={cn("relative z-0 h-[200vh]", className)}>
      <div className="sticky top-0 mx-auto flex h-[50%] max-w-4xl items-center bg-transparent px-4 py-20">{text}</div>
    </div>
  )
}

interface WordProps {
  children: ReactNode
  progress: MotionValue<number>
  range: [number, number]
  dim: number
  still: boolean
}

const Word: FC<WordProps> = ({ children, progress, range, dim, still }) => {
  const opacity = useTransform(progress, range, [0, 1])
  return (
    <span aria-hidden className="relative mr-[0.25em]">
      <span className="absolute" style={{ opacity: dim }}>
        {children}
      </span>
      <motion.span style={{ opacity: still ? 1 : opacity }}>{children}</motion.span>
    </span>
  )
}
