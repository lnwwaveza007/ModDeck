export type MathBlock = {
  id: string;
  label: string;
  latex: string;
};

export type CodeBlock = {
  id: string;
  label: string;
  lang: "python" | "java" | "sql";
  source: string;
};

export type SlidePayload = {
  type: "slide";
  title: string;
  sentAt: string;
  math: MathBlock[];
  code: CodeBlock[];
};

export const MATH_BLOCKS: MathBlock[] = [
  {
    id: "quadratic",
    label: "1. Quadratic formula (simple)",
    latex: "x = \\frac{-b \\pm \\sqrt{b^{2} - 4ac}}{2a}",
  },
  {
    id: "summation",
    label: "2. Summation",
    latex: "\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}",
  },
  {
    id: "integral",
    label: "3. Gaussian integral",
    latex: "\\int_{0}^{\\infty} e^{-x^{2}}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
  },
  {
    id: "matrix",
    label: "4. 3×3 matrix multiply",
    latex:
      "\\begin{pmatrix} a_{11} & a_{12} & a_{13} \\\\ a_{21} & a_{22} & a_{23} \\\\ a_{31} & a_{32} & a_{33} \\end{pmatrix}" +
      "\\begin{pmatrix} x \\\\ y \\\\ z \\end{pmatrix}" +
      "= \\begin{pmatrix} a_{11}x + a_{12}y + a_{13}z \\\\ a_{21}x + a_{22}y + a_{23}z \\\\ a_{31}x + a_{32}y + a_{33}z \\end{pmatrix}",
  },
  {
    id: "bayes",
    label: "5. Bayes with nested fractions (complex)",
    latex:
      "P(\\theta \\mid D) = \\frac{P(D \\mid \\theta)\\,P(\\theta)}{\\int_{\\Theta} P(D \\mid \\theta')\\,P(\\theta')\\,d\\theta'}" +
      "= \\frac{\\prod_{n=1}^{N} \\mathcal{N}(x_{n} \\mid \\mu, \\sigma^{2})\\,\\mathcal{N}(\\mu \\mid \\mu_{0}, \\tau^{2})}{Z(D)}",
  },
];

const PYTHON_SOURCE = `# Lecture demo: ordinary least squares from scratch
# 50+ lines on purpose — checks wrap, scroll, and highlight cost.

from dataclasses import dataclass
from typing import Iterable


@dataclass
class Fit:
    intercept: float
    slope: float
    r_squared: float


def mean(values: Iterable[float]) -> float:
    data = list(values)
    if not data:
        raise ValueError("mean() of empty sequence")
    return sum(data) / len(data)


def variance(values: list[float]) -> float:
    mu = mean(values)
    return sum((value - mu) ** 2 for value in values) / len(values)


def covariance(xs: list[float], ys: list[float]) -> float:
    if len(xs) != len(ys):
        raise ValueError("xs and ys must have the same length")
    x_mean = mean(xs)
    y_mean = mean(ys)
    paired = zip(xs, ys)
    return sum((x - x_mean) * (y - y_mean) for x, y in paired) / len(xs)


def fit_ols(xs: list[float], ys: list[float]) -> Fit:
    if len(xs) < 2:
        raise ValueError("need at least two points")
    slope = covariance(xs, ys) / variance(xs)
    intercept = mean(ys) - slope * mean(xs)
    predicted = [intercept + slope * x for x in xs]
    ss_res = sum((y - y_hat) ** 2 for y, y_hat in zip(ys, predicted))
    ss_tot = sum((y - mean(ys)) ** 2 for y in ys)
    r_squared = 1.0 - ss_res / ss_tot if ss_tot else 1.0
    return Fit(intercept=intercept, slope=slope, r_squared=r_squared)


def residual_plot(xs: list[float], ys: list[float], model: Fit) -> list[float]:
    residuals = []
    for x, y in zip(xs, ys):
        y_hat = model.intercept + model.slope * x
        residuals.append(y - y_hat)
    return residuals


if __name__ == "__main__":
    hours = [1, 2, 3, 4, 5, 6, 7, 8]
    scores = [52, 55, 60, 63, 68, 70, 74, 81]
    model = fit_ols(hours, scores)
    print(f"score = {model.intercept:.2f} + {model.slope:.2f} * hours")
    print(f"R^2 = {model.r_squared:.3f}")
    print("residuals:", residual_plot(hours, scores, model))
`;

export const CODE_BLOCKS: CodeBlock[] = [
  {
    id: "python-ols",
    label: "Python · OLS from scratch (50+ lines)",
    lang: "python",
    source: PYTHON_SOURCE.trimEnd() + "\n",
  },
  {
    id: "java-stack",
    label: "Java · bounded stack",
    lang: "java",
    source: `public final class BoundedStack<T> {
    private final Object[] items;
    private int size;

    public BoundedStack(int capacity) {
        if (capacity <= 0) {
            throw new IllegalArgumentException("capacity must be > 0");
        }
        this.items = new Object[capacity];
    }

    public void push(T value) {
        if (size == items.length) {
            throw new IllegalStateException("stack is full");
        }
        items[size++] = value;
    }

    @SuppressWarnings("unchecked")
    public T pop() {
        if (size == 0) {
            throw new IllegalStateException("stack is empty");
        }
        T value = (T) items[--size];
        items[size] = null;
        return value;
    }
}
`,
  },
  {
    id: "sql-enroll",
    label: "SQL · enrollment query",
    lang: "sql",
    source: `SELECT
    s.student_id,
    s.display_name,
    COUNT(e.session_id) AS sessions_joined,
    AVG(a.score)::numeric(5, 2) AS avg_score
FROM students AS s
LEFT JOIN enrollments AS e
    ON e.student_id = s.student_id
LEFT JOIN answers AS a
    ON a.student_id = s.student_id
   AND a.session_id = e.session_id
WHERE e.course_code = 'INT319'
  AND e.term = '1/2568'
GROUP BY s.student_id, s.display_name
HAVING COUNT(e.session_id) >= 3
ORDER BY avg_score DESC, s.display_name;
`,
  },
];

export function pythonLineCount(): number {
  return PYTHON_SOURCE.trim().split("\n").length;
}

export function buildSlidePayload(): SlidePayload {
  return {
    type: "slide",
    title: "MD-3 · Math and code rendering",
    sentAt: new Date().toISOString(),
    math: MATH_BLOCKS,
    code: CODE_BLOCKS,
  };
}
