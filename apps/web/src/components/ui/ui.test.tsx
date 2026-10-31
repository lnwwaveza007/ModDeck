import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Input } from "./Input";
import { ToastProvider, useToast } from "./Toast";
import { Toggle } from "./Toggle";

describe("Button", () => {
  it("is a non-submitting button with the primary token colours by default", () => {
    render(<Button>Start</Button>);
    const button = screen.getByRole("button", { name: "Start" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("bg-primary-600", "text-white", "h-11");
  });

  it("applies variant and size", () => {
    render(
      <Button variant="danger" size="lg" fullWidth>
        End
      </Button>,
    );
    expect(screen.getByRole("button")).toHaveClass("bg-error-600", "h-13", "w-full");
  });
});

describe("Input", () => {
  it("links the label, hint and error to the field", () => {
    render(<Input label="Nickname" hint="2–20 characters" error="Too short" />);
    const input = screen.getByLabelText("Nickname");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("2–20 characters Too short");
    expect(input).toHaveClass("border-error-600");
  });
});

describe("Toggle", () => {
  function Harness() {
    const [on, setOn] = useState(false);
    return <Toggle label="Reactions" checked={on} onCheckedChange={setOn} />;
  }

  it("is a labelled switch that flips on click", () => {
    render(<Harness />);
    const toggle = screen.getByRole("switch", { name: "Reactions" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveClass("bg-primary-600");
  });
});

describe("Badge and Card", () => {
  it("use tone tokens", () => {
    render(
      <Card tone="accent" data-testid="card">
        <Badge tone="success">Live</Badge>
      </Card>,
    );
    expect(screen.getByText("Live")).toHaveClass("bg-success-50", "text-success-700");
    expect(screen.getByTestId("card")).toHaveClass("bg-primary-50", "border-primary-200");
  });
});

describe("Toast", () => {
  function Trigger() {
    const toast = useToast();
    return <button onClick={() => toast("Saved", { tone: "success" })}>save</button>;
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows a message and hides it after the duration", () => {
    render(
      <ToastProvider closeLabel="Close">
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("save"));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    act(() => jest.advanceTimersByTime(4000));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("can be closed by hand", () => {
    render(
      <ToastProvider closeLabel="Close">
        <Trigger />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("save"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
  });

  it("runs an action button once and closes the toast", () => {
    const undo = jest.fn();
    function WithAction() {
      const toast = useToast();
      return (
        <button onClick={() => toast("Deleted", { action: { label: "Undo", onClick: undo } })}>
          delete
        </button>
      );
    }
    render(
      <ToastProvider closeLabel="Close">
        <WithAction />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("delete"));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
  });

  it("throws outside the provider", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow("useToast must be used inside <ToastProvider>");
  });
});
