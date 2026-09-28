import { useRef } from "react";
import { useModalBehavior } from "../hooks/useModalBehavior";

export function RecipeModal({ open, recipe, onClose, returnFocusRef }) {
  const cardRef = useRef(null);
  useModalBehavior(open, onClose, cardRef, returnFocusRef);

  if (!open || !recipe) return null;

  return (
    <div className="soupcon-recipe-overlay modal-overlay" onClick={onClose}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-modal-title"
        className="soupcon-recipe-card modal-card"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header-row">
          <h2 id="recipe-modal-title" className="modal-title">
            {recipe.title}
          </h2>
          <div className="soupcon-no-print modal-button-group">
            <button type="button" onClick={() => window.print()} className="modal-print-button">
              Print
            </button>
            <button type="button" onClick={onClose} aria-label="Close recipe" className="modal-close-button">
              ×
            </button>
          </div>
        </div>

        <div className="modal-section">
          <div className="modal-section-title">Ingredients</div>
          <ul className="modal-list">
            {recipe.ingredients.map((item, index) => (
              <li
                key={index}
                className={
                  item.endsWith(":") ? "modal-list-item modal-list-item--group" : "modal-list-item"
                }
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="modal-section--spaced">
          <div className="modal-section-title">Steps</div>
          <ol className="modal-list">
            {recipe.steps.map((step, index) => (
              <li key={index} className="modal-list-item--spaced">
                {step}
              </li>
            ))}
          </ol>
        </div>

        {recipe.storyHeading && recipe.storyParagraphs ? (
          <div className="modal-section--spaced">
            <div className="modal-section-title">{recipe.storyHeading}</div>
            {recipe.storyParagraphs.map((paragraph, index) => (
              <p key={index} className="modal-paragraph">
                {paragraph}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
