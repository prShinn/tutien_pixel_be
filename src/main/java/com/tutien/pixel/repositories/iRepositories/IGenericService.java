package com.tutien.pixel.repositories.iRepositories;

import com.tutien.pixel.entities.worldEntity;

import java.util.List;
import java.util.Optional;

public interface IGenericService<T, ID> {
    List<T> findAll();
    Optional<T> findById(ID id);

    Optional<T> findByCode(String code);

    T save(T entity);
    T update(ID id, T entity);
    void delete(ID id);
}