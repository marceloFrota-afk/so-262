/** Interface do buffer compartilhado. */
public interface Buffer {
    void insert(Object item);
    Object remove();
}
